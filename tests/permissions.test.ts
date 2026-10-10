import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createSeed } from "../src/lib/data";
import { diffWorkspace, emptyWorkspace } from "../src/lib/cloud";
import { validateAsset } from "../src/lib/file-validation";
import { schemas, validateChanges, validateAssetStorage } from "../src/lib/record-schema";

test("record validation, changes, and file signatures reject malformed input", () => {
  const seed = createSeed();
  const next = structuredClone(seed);
  next.posts[0].caption = "Changed";
  assert.equal(diffWorkspace(seed, next).length, 1);
  assert.throws(() =>
    validateChanges([
      { kind: "posts", id: "wrong", before: null, after: next.posts[0] },
    ]),
  );
  assert.throws(() =>
    schemas.leads.parse({ ...seed.leads[0], stage: "Owner" }),
  );
  const wid = "20000000-0000-4000-8000-000000000001";
  const sample = { ...seed.assets[0], uploaded: false };
  assert.throws(() => schemas.assets.parse({ ...sample, storagePath: `${wid}/other/file.png` }));
  assert.throws(() => schemas.assets.parse({ ...sample, uploaded: true }));
  for (const storagePath of [`${wid}/other/file.png`, `other/${sample.clientId}/file.png`, `${wid}/${sample.clientId}/../file.png`, `${wid}/${sample.clientId}/`]) {
    const asset = { ...sample, uploaded: true, storagePath };
    assert.throws(() => validateAssetStorage(wid, asset));
    assert.throws(() => validateChanges([{ kind: "assets", id: asset.id, before: null, after: asset }], wid));
  }
  validateAssetStorage(wid, { ...sample, uploaded: true, storagePath: `${wid}/${sample.clientId}/file.png` });
  assert.equal(
    validateAsset(
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      "image/png",
    ),
    "png",
  );
  assert.throws(() =>
    validateAsset(
      new TextEncoder().encode("<svg onload='attack()'>"),
      "image/png",
    ),
  );
  assert.throws(() =>
    validateAsset(new Uint8Array(10 * 1024 * 1024 + 1), "image/png"),
  );
});

test("PostgreSQL permissions, invitations, version approval and atomic conflicts", async (t) => {
  const db = new PGlite();
  const owner = "10000000-0000-4000-8000-000000000001",
    team = "10000000-0000-4000-8000-000000000002",
    reviewer = "10000000-0000-4000-8000-000000000003",
    outsider = "10000000-0000-4000-8000-000000000004";
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,storage to authenticated;
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
    alter table storage.objects enable row level security;
    grant select,insert,delete on storage.objects to authenticated;
    insert into auth.users values('${owner}','owner@example.test',now()),('${team}','team@example.test',now()),('${reviewer}','reviewer@example.test',now()),('${outsider}','outsider@example.test',now());`);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/202610090001_workspace.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/202610090002_storage.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/202610090003_atomic_import.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(await readFile(new URL(
    "../supabase/migrations/20261009183529_harden_assets_and_posts.sql", import.meta.url,
  ), "utf8"));
  async function as(user: string) {
    await db.exec("reset role; set role authenticated;");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
  }
  async function rpc(name: string, args: unknown[] = []) {
    return db.query<{ result: unknown }>(
      `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
      args,
    );
  }
  await as(owner);
  const wid = (await rpc("create_workspace", ["Test agency"])).rows[0]
    .result as string;
  const seed = createSeed();
  const a = { ...seed.clients[0], id: "a" },
    b = { ...seed.clients[1], id: "b" };
  const asset = { ...seed.assets[0], id: "asset-a", clientId: "a" };
  const post = {
    ...seed.posts[0],
    id: "post-a",
    clientId: "a",
    assetId: "asset-a",
    status: "Draft",
    date: "2026-10-20",
    time: "09:00",
    notes: [],
  };
  const lead = {
    ...seed.leads[0],
    id: "lead-a",
    clientId: "a",
    task: "Call prospect",
  };
  async function commit(changes: unknown[]) {
    return rpc("commit_records", [wid, JSON.stringify(changes), null]);
  }
  await commit([
    { kind: "clients", id: "a", before: null, after: a },
    { kind: "clients", id: "b", before: null, after: b },
    { kind: "assets", id: asset.id, before: null, after: asset },
    { kind: "posts", id: post.id, before: null, after: post },
    { kind: "leads", id: lead.id, before: null, after: lead },
  ]);
  await assert.rejects(rpc("import_records", [wid, "[]"]), /empty workspace/);
  await rpc("create_invitation", [
    wid,
    "team@example.test",
    "team_member",
    ["a"],
  ]);
  await rpc("create_invitation", [
    wid,
    "reviewer@example.test",
    "client_reviewer",
    ["a"],
  ]);
  await t.test(
    "verified invitations grant only assigned clients and cannot escalate",
    async () => {
      await as(team);
      await rpc("accept_invitations");
      assert.deepEqual((await db.query("select id from public.clients")).rows, [
        { id: "a" },
      ]);
      assert.equal(
        (await db.query("select * from public.records where kind='tasks'")).rows
          .length,
        1,
      );
      await assert.rejects(
        rpc("create_invitation", [
          wid,
          "outsider@example.test",
          "team_member",
          ["b"],
        ]),
        /Only owners/,
      );
      await assert.rejects(
        db.query("update public.workspace_members set role='owner'"),
        /permission denied/,
      );
      await assert.rejects(
        commit([
          {
            kind: "clients",
            id: "b",
            before: b,
            after: { ...b, name: "Stolen" },
          },
        ]),
        /Only owners/,
      );
    },
  );
  await t.test(
    "direct RPC rejects malformed posts and rolls back the complete batch",
    async () => {
      await as(team);
      await assert.rejects(rpc("commit_records", [wid, null, null]), /Invalid changes/);
      await assert.rejects(commit([{ kind: null, id: "bad", before: null, after: post }]), /Invalid record/);
      const candidate: Record<string, unknown> = { ...post, id: "bad-post" };
      const malformed: Record<string, unknown>[] = [];
      for (const field of ["title", "caption", "platform", "date", "time", "status", "assetId", "notes"]) {
        const missing = { ...candidate };
        delete missing[field];
        malformed.push(missing, { ...candidate, [field]: null }, { ...candidate, [field]: 42 });
      }
      malformed.push(
        { ...candidate, status: "Owner" },
        { ...candidate, title: "x".repeat(20001) },
        { ...candidate, unknownField: true },
        { ...candidate, notes: [null] },
        { ...candidate, notes: [{ text: "Feedback" }] },
        { ...candidate, notes: [{ text: 1, date: "today" }] },
        { ...candidate, notes: Array.from({ length: 501 }, () => ({ text: "", date: "" })) },
        { ...candidate, metrics: null },
        { ...candidate, metrics: { reach: "1", engagements: 2, leads: 3 } },
        { ...candidate, metrics: { reach: 1, engagements: 2 } },
      );
      const before = (await db.query("select * from public.activity_log where workspace_id=$1", [wid])).rows.length;
      for (const after of malformed) {
        await assert.rejects(commit([
          { kind: "leads", id: "rollback-lead", before: null, after: { ...lead, id: "rollback-lead" } },
          { kind: "posts", id: "bad-post", before: null, after },
        ]), /Invalid post payload/);
      }
      assert.equal((await db.query("select * from public.records where id in ('bad-post','rollback-lead')")).rows.length, 0);
      assert.equal((await db.query("select * from public.activity_log where workspace_id=$1", [wid])).rows.length, before);
      const valid = { ...candidate, metrics: { reach: 1, engagements: 2, leads: 3 }, notes: [{ text: "Feedback", date: "today" }] };
      await commit([{ kind: "posts", id: "bad-post", before: null, after: valid }]);
      await assert.rejects(commit([{ kind: "posts", id: "bad-post", before: valid, after: { ...valid, status: null } }]), /Invalid post payload/);
      await commit([{ kind: "posts", id: "bad-post", before: valid, after: null }]);
    },
  );
  await t.test(
    "forged metadata cannot authorize another client or workspace, including legacy records",
    async () => {
      await as(outsider);
      const otherWid = (await rpc("create_workspace", ["Storage isolation"])).rows[0].result as string;
      await rpc("commit_records", [otherWid, JSON.stringify([{ kind: "clients", id: "a", before: null, after: a }]), null]);
      const paths = [wid + "/b/private.png", otherWid + "/a/private.png", wid + "/axb/private.png"];
      // Simulate metadata forged before the upgrade, independently of the repaired RPC.
      await db.exec("reset role");
      for (const [i, path] of paths.entries()) {
        await db.query("insert into storage.objects(bucket_id,name) values('grailhiiv-assets',$1)", [path]);
        await db.query("insert into public.records(workspace_id,kind,id,client_id,payload,revision) values($1,'assets',$2,'a',$3,1)",
          [wid, `legacy-${i}`, JSON.stringify({ ...asset, id: `legacy-${i}`, uploaded: false, storagePath: path })]);
      }
      await as(team);
      assert.equal((await db.query("select * from storage.objects where name=any($1::text[])", [paths])).rows.length, 0);
      for (const path of [...paths, wid + "/a/file.png", wid + "/a/", wid + "/a/../private.png"]) {
        for (const uploaded of [false, true]) {
          const forged = { ...asset, id: "forged", uploaded, storagePath: path };
          await assert.rejects(commit([{ kind: "assets", id: forged.id, before: null, after: forged }]),
            /Asset storage path|Upload the file/);
        }
      }
      for (const after of [{ ...asset, uploaded: null }, { ...asset, uploaded: "true" }, { ...asset, uploaded: true }, { ...asset, storagePath: null }]) {
        await assert.rejects(commit([{ kind: "assets", id: "malformed-asset", before: null, after: { ...after, id: "malformed-asset" } }]), /Asset storage path/);
      }
      // '_' in client IDs must be literal, never a LIKE wildcard.
      assert.equal((await db.query<{ valid: boolean }>("select public.valid_asset_storage($1,'a_b',$2) as valid", [wid, JSON.stringify({ uploaded: true, storagePath: wid + "/axb/private.png" })])).rows[0].valid, false);
      await as(owner);
      assert.equal((await db.query("select * from storage.objects where name=any($1::text[])", [paths])).rows.length, 0);
      await db.exec("reset role");
      await db.query("delete from public.records where workspace_id=$1 and id like 'legacy-%'", [wid]);
      await db.query("delete from storage.objects where name=any($1::text[])", [paths]);
      await db.query("delete from public.workspaces where id=$1", [otherWid]);
    },
  );
  await t.test(
    "reviewers cannot read leads or edit content, but can approve submitted versions",
    async () => {
      await as(team);
      const submitted = { ...post, status: "Awaiting approval" };
      await commit([
        { kind: "posts", id: post.id, before: post, after: submitted },
      ]);
      await assert.rejects(
        commit([
          {
            kind: "posts",
            id: post.id,
            before: submitted,
            after: { ...submitted, status: "Scheduled" },
          },
        ]),
        /must approve/,
      );
      await as(reviewer);
      await rpc("accept_invitations");
      assert.equal(
        (await db.query("select * from public.records where kind='leads'")).rows
          .length,
        0,
      );
      assert.equal(
        (await db.query("select * from public.records where kind='tasks'")).rows
          .length,
        0,
      );
      await assert.rejects(
        commit([
          {
            kind: "posts",
            id: post.id,
            before: submitted,
            after: { ...submitted, caption: "Tampered" },
          },
        ]),
        /cannot edit content/,
      );
      const approved = { ...submitted, status: "Scheduled" };
      await commit([
        { kind: "posts", id: post.id, before: submitted, after: approved },
      ]);
      const approvals = await db.query<{ content_snapshot: typeof approved }>(
        "select content_snapshot from public.approvals",
      );
      assert.equal(
        approvals.rows[0].content_snapshot.caption,
        approved.caption,
      );
      await as(team);
      await assert.rejects(
        commit([
          {
            kind: "posts",
            id: post.id,
            before: approved,
            after: { ...approved, caption: "Edited" },
          },
        ]),
        /return to Draft/,
      );
      await commit([
        {
          kind: "posts",
          id: post.id,
          before: approved,
          after: { ...approved, status: "Draft", caption: "Edited" },
        },
      ]);
      await assert.rejects(
        commit([
          {
            kind: "posts",
            id: post.id,
            before: approved,
            after: { ...approved, status: "Draft" },
          },
        ]),
        /another device/,
      );
    },
  );
  await t.test(
    "a user from another workspace cannot read or write any agency records",
    async () => {
      await as(outsider);
      await rpc("create_workspace", ["Other agency"]);
      assert.equal(
        (await db.query("select * from public.clients")).rows.length,
        0,
      );
      assert.equal(
        (await db.query("select * from public.records")).rows.length,
        0,
      );
      assert.equal(
        (await db.query("select * from public.approvals")).rows.length,
        0,
      );
      assert.equal(
        (
          await db.query(
            "select * from public.activity_log where workspace_id=$1",
            [wid],
          )
        ).rows.length,
        0,
      );
      await assert.rejects(
        commit([
          {
            kind: "leads",
            id: lead.id,
            before: lead,
            after: { ...lead, name: "Leak" },
          },
        ]),
        /access denied/,
      );
    },
  );
  await t.test(
    "private storage forbids other clients, reviewers' uploads and orphan downloads",
    async () => {
      await as(team);
      const path = wid + "/a/file.png";
      await db.query(
        "insert into storage.objects(bucket_id,name) values('grailhiiv-assets',$1)",
        [path],
      );
      assert.equal(
        (await db.query("select * from storage.objects")).rows.length,
        0,
      );
      await assert.rejects(
        db.query(
          "insert into storage.objects(bucket_id,name) values('grailhiiv-assets',$1)",
          [wid + "/b/file.png"],
        ),
        /row-level security/,
      );
      const uploaded = {
        ...asset,
        id: "upload-a",
        uploaded: true,
        storagePath: path,
        url: "/api/assets/file",
      };
      await commit([
        { kind: "assets", id: uploaded.id, before: null, after: uploaded },
      ]);
      assert.equal(
        (await db.query("select * from storage.objects")).rows.length,
        1,
      );
      await as(reviewer);
      assert.equal(
        (await db.query("select * from storage.objects")).rows.length,
        1,
      );
      await assert.rejects(
        db.query(
          "insert into storage.objects(bucket_id,name) values('grailhiiv-assets',$1)",
          [wid + "/a/reviewer.png"],
        ),
        /row-level security/,
      );
      await as(outsider);
      assert.equal(
        (await db.query("select * from storage.objects")).rows.length,
        0,
      );
    },
  );
  await t.test(
    "removing a member immediately revokes database and storage access",
    async () => {
      await as(owner);
      await rpc("manage_member", [wid, team, "team_member", [], true]);
      await as(team);
      assert.equal(
        (await db.query("select * from public.records")).rows.length,
        0,
      );
      assert.equal(
        (await db.query("select * from storage.objects")).rows.length,
        0,
      );
      await assert.rejects(commit([]), /access denied/);
    },
  );
  await db.close();
});
