import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createSeed } from "../src/lib/data";
import { MetaError, discoverPages, exchangeCode, graph, openToken, publishMeta, sealToken } from "../src/lib/social-meta";

async function fixture(t: TestContext) {
  const db = new PGlite(); t.after(() => db.close());
  const owner = "10000000-0000-4000-8000-000000000001", team = "10000000-0000-4000-8000-000000000002";
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,storage to authenticated,service_role;
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;`);
  for (const [id, email] of [[owner,"owner@example.test"],[team,"team@example.test"]]) await db.query("insert into auth.users values($1,$2,now())",[id,email]);
  for (const name of ["202610090001_workspace.sql","202610090002_storage.sql","202610090003_atomic_import.sql","20261009183529_harden_assets_and_posts.sql","20261010071129_n8n_automation_bridge.sql","20261010120000_ai_agents.sql","20261011041605_internal_operations.sql","20261011065141_social_publishing.sql","20261011071311_social_publishing_asset_guard.sql"]) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),"utf8"));
  async function as(id = owner, role = "authenticated") { await db.exec(`reset role;set role ${role}`); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); }
  async function rpc(name: string,args: unknown[] = []) { return (await db.query<{value:any}>(`select public.${name}(${args.map((_,i)=>"$"+(i+1)).join(",")}) as value`,args)).rows[0]?.value; }
  await as(); const wid = await rpc("create_workspace",["Social test"]);
  const client = {...createSeed().clients[0],id:"a",timezone:"UTC",approvalRequired:true};
  await rpc("commit_records",[wid,JSON.stringify([{kind:"clients",id:"a",before:null,after:client}]),null]);
  await rpc("create_invitation",[wid,"team@example.test","team_member",["a"]]); await as(team); await rpc("accept_invitations"); await as();
  const due = new Date(Date.now()+60000).toISOString();
  let post = {...createSeed().posts[0],id:"post",clientId:"a",platform:"Facebook",assetId:"",caption:"Approved caption",date:due.slice(0,10),time:due.slice(11,16),status:"Draft"};
  async function save(next: typeof post) { await rpc("commit_records",[wid,JSON.stringify([{kind:"posts",id:post.id,before:post,after:next}]),null]); post=next; }
  await rpc("commit_records",[wid,JSON.stringify([{kind:"posts",id:post.id,before:null,after:post}]),null]);
  await save({...post,status:"Awaiting approval"}); await save({...post,status:"Scheduled"});
  await as("","service_role"); const sid = await rpc("save_social_connection",[wid,"a",owner,"Facebook","123","Test Page","encrypted"]);
  await as(); await rpc("manage_social_connection",[wid,sid,"enable"]); await as("","service_role");
  await rpc("queue_social_posts"); await db.exec("reset role"); await db.exec("update public.publish_jobs set due_at=now()-interval '1 minute'"); await as("","service_role");
  return {db,as,rpc,wid,sid,owner,team,save,get post(){return post;}};
}
test("publishing requires exact approval, leases once, freezes content, saves a receipt atomically",async t=>{
  const f=await fixture(t), {rpc,as,db,wid}=f;
  const job=await rpc("claim_publish_job"); assert.equal(job.state,"Preparing"); assert.equal(await rpc("claim_publish_job"),null);
  await rpc("prepare_publish_job",[job.id,job.lease,null,true]);
  await as(); await assert.rejects(f.save({...f.post,caption:"Changed",status:"Draft"}),/Publishing is in progress/);
  await as("","service_role"); await rpc("finish_publish_job",[job.id,job.lease,"Published","123_456","Provider confirmed delivery."]);
  await as(); const row=(await db.query<{payload:any}>("select payload from public.records where workspace_id=$1 and kind='posts'",[wid])).rows[0]; assert.equal(row.payload.status,"Published");
  await as("","service_role"); await rpc("queue_social_posts"); assert.equal(await rpc("claim_publish_job"),null);
  await assert.rejects(rpc("finish_publish_job",[job.id,job.lease,"Published","123_456",""]),/lease expired/);
});
test("stale approval, revoked membership and disabled destination prevent external sending",async t=>{
  const f=await fixture(t),{rpc,as,db,wid,owner}=f;
  const job=await rpc("claim_publish_job"); await as(); await f.save({...f.post,caption:"Unapproved edit",status:"Draft"});
  await as("","service_role"); assert.equal(await rpc("prepare_publish_job",[job.id,job.lease]),null);
  assert.equal((await db.query<{state:string}>("select state from public.publish_jobs")).rows[0].state,"Cancelled");
  await as(); await f.save({...f.post,status:"Awaiting approval"}); await f.save({...f.post,status:"Scheduled"}); await as("","service_role"); await rpc("queue_social_posts");
  await db.exec("reset role"); await db.exec("update public.publish_jobs set due_at=now()-interval '1 minute' where state='Queued'"); await as("","service_role");
  const newJob=await rpc("claim_publish_job"); assert.ok(newJob);
  await db.exec("reset role"); await db.query("delete from public.workspace_members where workspace_id=$1 and user_id=$2",[wid,owner]); await as("","service_role");
  assert.equal(await rpc("prepare_publish_job",[newJob.id,newJob.lease,null,true]),null);
});
test("uncertain deliveries never retry automatically; only owner review permits another attempt",async t=>{
  const {rpc,as,db,wid,team}=await fixture(t); const job=await rpc("claim_publish_job");
  await rpc("prepare_publish_job",[job.id,job.lease,null,true]); await db.exec("reset role"); await db.exec("update public.publish_jobs set lease_until=now()-interval '1 minute'"); await as("","service_role");
  await rpc("queue_social_posts"); assert.equal(await rpc("claim_publish_job"),null);
  assert.equal((await db.query<{state:string}>("select state from public.publish_jobs")).rows[0].state,"Needs review");
  await as(team); await assert.rejects(rpc("review_publish_job",[wid,job.id,"retry_uncertain"]),/Only owners/);
  await as(); await assert.rejects(rpc("review_publish_job",[wid,job.id,"retry"]),/Uncertain/);
  await rpc("review_publish_job",[wid,job.id,"retry_uncertain"]); await as("","service_role"); assert.ok(await rpc("claim_publish_job"));
});
test("tokens are inaccessible to users, publishing RPCs are service-only and user mutations cannot forge Published",async t=>{
  const f=await fixture(t),{as,db,rpc,wid,sid,team}=f;
  await as(); await assert.rejects(db.query("select token_cipher from public.social_connections"),/permission denied/);
  await assert.rejects(rpc("claim_publish_job"),/permission denied/); await assert.rejects(f.save({...f.post,status:"Published"}),/Publishing is not connected/);
  await as(team); await assert.rejects(rpc("manage_social_connection",[wid,sid,"enable"]),/Only owners/);
  await as("","anon"); await assert.rejects(db.query("select * from public.publish_jobs"),/permission denied/);
});
test("encrypted tokens bind to client/platform and cannot be moved or tampered with",()=>{
  const previous=process.env.GRAILHIIV_SOCIAL_ENCRYPTION_KEY; process.env.GRAILHIIV_SOCIAL_ENCRYPTION_KEY="a".repeat(64);
  try { const cipher=sealToken("secret-page-token","workspace:a:Facebook"); assert.equal(openToken(cipher,"workspace:a:Facebook"),"secret-page-token"); assert.throws(()=>openToken(cipher,"workspace:b:Facebook")); const bytes=Buffer.from(cipher,"base64"); bytes[15]^=1; assert.throws(()=>openToken(bytes.toString("base64"),"workspace:a:Facebook")); } finally { if(previous===undefined) delete process.env.GRAILHIIV_SOCIAL_ENCRYPTION_KEY; else process.env.GRAILHIIV_SOCIAL_ENCRYPTION_KEY=previous; }
});
test("Meta publishes only after final validation, saves containers and holds uncertain provider responses",async()=>{
  const calls:string[]=[]; const fake=async (url:any,init:any)=>{ calls.push(new URL(url).pathname); assert.equal(init.headers.Authorization,"Bearer token"); if(new URL(url).pathname.endsWith("/media")) return Response.json({id:"789"}); if(init.method==="GET") return Response.json({status_code:"FINISHED"}); return Response.json({id:"1011"}); };
  const id=await publishMeta({platform:"Instagram",accountId:"123",token:"token",caption:"Caption",imageUrl:"https://example.test/photo.jpg"},{saveContainer:async c=>{assert.equal(c,"789");calls.push("saved");},beforeSend:async()=>{calls.push("validated");}},fake as typeof fetch);
  assert.equal(id,"1011"); assert.deepEqual(calls,["/v25.0/123/media","saved","/v25.0/789","validated","/v25.0/123/media_publish"]);
  let sends=0;
  await assert.rejects(publishMeta({platform:"Facebook",accountId:"123",token:"token",caption:"Caption"},{saveContainer:async()=>{},beforeSend:async()=>{throw new Error("stale");}},async()=>{sends++;return Response.json({id:"456"});}),/stale/); assert.equal(sends,0);
  await assert.rejects(graph("123/feed","token",{},"POST",async()=>{throw new Error("timeout contains secret token");}),e=>e instanceof MetaError && e.uncertain && e.message==="delivery_unknown");
});
test("Page discovery paginates without following provider-supplied URLs",async()=>{
  const seen:string[]=[];
  const pages=await discoverPages("token",async(url)=>{const u=new URL(String(url));seen.push(u.hostname);return Response.json({data:[{id:u.searchParams.has("after")?"456":"123",name:"Page",tasks:["CREATE_CONTENT"],access_token:"token"}],...(u.searchParams.has("after")?{}:{paging:{next:"https://untrusted.test/steal",cursors:{after:"cursor"}}})});});
  assert.equal(pages.length,2);assert.deepEqual(seen,["graph.facebook.com","graph.facebook.com"]);
});
test("authorization exchanges the code and upgrades the user token without exposing secrets in URLs",async()=>{
  const bodies:URLSearchParams[]=[];
  const token=await exchangeCode("authorization-code","https://app.example.test/api/social/callback",async(url,init)=>{
    assert.equal(new URL(String(url)).search,""); assert.equal(init?.method,"POST"); const body=init?.body as URLSearchParams; bodies.push(body); return Response.json({access_token:bodies.length===1?"short-token":"long-token"});
  });
  assert.equal(token,"long-token"); assert.equal(bodies[0].get("code"),"authorization-code"); assert.equal(bodies[1].get("grant_type"),"fb_exchange_token"); assert.equal(bodies[1].get("fb_exchange_token"),"short-token");
});
test("registered and previously approved asset paths cannot be recycled under an upload reservation",async t=>{
  const f=await fixture(t),{db,as,rpc,wid}=f; const rid=crypto.randomUUID(),path=`${wid}/a/${rid}.jpg`;
  await as(); await rpc("reserve_asset_upload",[wid,"a",rid,100,"jpg"]);
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('grailhiiv-assets',$1,'{\"size\":100}')",[path]);
  await db.exec("reset role");
  await db.query("insert into public.records(workspace_id,kind,id,client_id,payload) values($1,'assets',$2,'a',$3)",[wid,rid,JSON.stringify({storagePath:path,uploaded:true,status:"Approved"})]);
  await as(); assert.equal(await rpc("asset_upload_allowed",[path,100]),false);
  await db.exec("reset role"); await db.query("delete from public.records where workspace_id=$1 and kind='assets' and id=$2",[wid,rid]);
  await db.query("update public.approvals set content_snapshot=jsonb_set(content_snapshot,'{assetId}',to_jsonb($1::text)) where workspace_id=$2",[rid,wid]);
  await as(); assert.equal(await rpc("asset_upload_allowed",[path,100]),false);
  const fresh=crypto.randomUUID(); await rpc("reserve_asset_upload",[wid,"a",fresh,100,"jpg"]); assert.equal(await rpc("asset_upload_allowed",[`${wid}/a/${fresh}.jpg`,100]),true);
});
