import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createSeed } from "../src/lib/data";
import { planSchema } from "../src/lib/agent-config";
import { defaultLimits } from "../src/lib/operations";
import { workerIsHealthy } from "../src/lib/worker-monitor";
import { createThumbnail } from "../src/lib/asset-thumbnail";
import sharp from "sharp";

async function fixture(t: TestContext) {
  const db = new PGlite();
  t.after(() => db.close());
  const [owner, team, reviewer] = [1, 2, 3].map(
    (n) => `10000000-0000-4000-8000-00000000000${n}`,
  );
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth,storage to authenticated,service_role;
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
  alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;`);
  for (const [id, email] of [
    [owner, "owner@example.test"],
    [team, "team@example.test"],
    [reviewer, "reviewer@example.test"],
  ])
    await db.query("insert into auth.users values($1,$2,now())", [id, email]);
  for (const name of [
    "202610090001_workspace.sql",
    "202610090002_storage.sql",
    "202610090003_atomic_import.sql",
    "20261009183529_harden_assets_and_posts.sql",
    "20261010071129_n8n_automation_bridge.sql",
    "20261010120000_ai_agents.sql",
    "20261011041605_internal_operations.sql",
  ])
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  async function as(id = owner, role = "authenticated") {
    await db.exec(`reset role;set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  }
  async function rpc(name: string, args: unknown[] = []) {
    return (
      await db.query<{ value: any }>(
        `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as value`,
        args,
      )
    ).rows[0]?.value;
  }
  await as();
  const wid = await rpc("create_workspace", ["Operations test"]);
  const clients = createSeed()
    .clients.slice(0, 2)
    .map((c, i) => ({ ...c, id: i ? "b" : "a" }));
  await rpc("commit_records", [
    wid,
    JSON.stringify(
      clients.map((c) => ({
        kind: "clients",
        id: c.id,
        before: null,
        after: c,
      })),
    ),
    null,
  ]);
  for (const [email, role] of [
    ["team@example.test", "team_member"],
    ["reviewer@example.test", "client_reviewer"],
  ])
    await rpc("create_invitation", [wid, email, role, ["a"]]);
  await as(team);
  await rpc("accept_invitations");
  await as(reviewer);
  await rpc("accept_invitations");
  await as();
  const claim = async () => {
    await as("", "service_role");
    return (
      await db.query<{ id: string; lease: string; generation_seq: number }>(
        "select * from public.claim_agent()",
      )
    ).rows[0];
  };
  return { db, owner, team, reviewer, wid, as, rpc, claim };
}
const plan = planSchema.parse({
  posts: Array.from({ length: 5 }, (_, i) => ({
    title: `Idea ${i + 1}`,
    caption: `Caption ${i + 1}`,
    platform: "Instagram",
  })),
});
const model = {
  key: "test",
  label: "Test",
  provider: "openai",
  model: "test-model",
  maxTokens: 4096,
  inputPricePerMillion: 1,
  outputPricePerMillion: 2,
};

test("proposal edits, regeneration and decisions reject stale versions and keep human approval", async (t) => {
  const f = await fixture(t),
    { rpc, as, claim, wid, team, reviewer, db } = f;
  const id = crypto.randomUUID();
  await rpc("enqueue_agent", [
    wid,
    "a",
    id,
    JSON.stringify(model),
    "Write five posts",
  ]);
  let job = await claim();
  await rpc("finish_agent", [
    id,
    job.lease,
    "Awaiting approval",
    JSON.stringify(plan),
  ]);
  const edited = structuredClone(plan);
  edited.posts[0] = {
    ...edited.posts[0],
    title: "Edited title",
    date: "2026-10-20",
    time: "10:15",
  };
  await as(reviewer);
  await assert.rejects(
    rpc("edit_agent_plan", [
      wid,
      id,
      JSON.stringify(plan),
      JSON.stringify(edited),
    ]),
    /access denied/,
  );
  await as(team);
  await rpc("edit_agent_plan", [
    wid,
    id,
    JSON.stringify(plan),
    JSON.stringify(edited),
  ]);
  await assert.rejects(
    rpc("edit_agent_plan", [
      wid,
      id,
      JSON.stringify(plan),
      JSON.stringify(plan),
    ]),
    /Proposal changed/,
  );
  await assert.rejects(
    rpc("decide_agent", [wid, id, true, JSON.stringify(plan)]),
    /Proposal changed/,
  );
  const requestId = crypto.randomUUID();
  await rpc("regenerate_agent_post", [
    wid,
    id,
    0,
    JSON.stringify(edited),
    requestId,
  ]);
  await rpc("regenerate_agent_post", [
    wid,
    id,
    0,
    JSON.stringify(edited),
    requestId,
  ]);
  job = await claim();
  assert.equal(job.generation_seq, 1);
  const regenerated = structuredClone(edited);
  regenerated.posts[0].caption = "Regenerated caption";
  await rpc("finish_agent", [
    id,
    job.lease,
    "Awaiting approval",
    JSON.stringify(regenerated),
  ]);
  await as(team);
  await rpc("decide_agent", [wid, id, true, JSON.stringify(regenerated)]);
  job = await claim();
  await rpc("finish_agent", [id, job.lease, "Completed", null]);
  await as(f.owner);
  const rows = await db.query<{ payload: any }>(
    "select payload from public.records where kind='posts' order by id",
  );
  assert.equal(rows.rows.length, 5);
  assert.equal(rows.rows[0].payload.caption, "Regenerated caption");
  assert.equal(rows.rows[0].payload.date, "2026-10-20");
  assert.equal(rows.rows[0].payload.status, "Draft");
});
test("AI call limits and token/cost reports are reserved atomically and protected from team writes", async (t) => {
  const { rpc, as, claim, wid, team, db } = await fixture(t);
  await rpc("save_operations", [
    wid,
    JSON.stringify({
      ...defaultLimits,
      hourly_ai_calls: 1,
      reasoning_effort: "low",
    }),
  ]);
  const id = crypto.randomUUID();
  await rpc("enqueue_agent", [wid, "a", id, JSON.stringify(model), "Write"]);
  const job = await claim();
  const prepared = await rpc("prepare_agent_config", [
    id,
    job.lease,
    JSON.stringify({ ...model, model: "gpt-5.6-luna" }),
  ]);
  assert.equal(prepared.reasoningEffort, "low");
  const reservation = await rpc("reserve_agent_call", [id, job.lease]);
  assert.equal(await rpc("reserve_agent_call", [id, job.lease]), reservation);
  await rpc("report_agent_usage", [id, job.lease, 600, 100]);
  await rpc("report_agent_usage", [id, job.lease, 999, 999]);
  const usage = (
    await db.query<{ input_tokens: number; estimated_cost: number }>(
      "select input_tokens,estimated_cost from public.agent_usage",
    )
  ).rows[0];
  assert.equal(usage.input_tokens, 600);
  assert.equal(Number(usage.estimated_cost), 0.0008);
  await as(team);
  await assert.rejects(
    rpc("prepare_agent_config", [id, job.lease, JSON.stringify(model)]),
    /permission denied/,
  );
  await assert.rejects(rpc("backup_snapshot"), /permission denied/);
  await assert.rejects(
    rpc("save_operations", [wid, JSON.stringify(defaultLimits)]),
    /Only owners/,
  );
  await assert.rejects(
    rpc("worker_heartbeat", ["ai", true, ""]),
    /permission denied/,
  );
  await as();
  const totals = await rpc("operations_usage_summary", [wid]);
  assert.equal(totals.tokens, 700);
  assert.equal(totals.unpriced, 0);
  await rpc("save_operations", [
    wid,
    JSON.stringify({ ...defaultLimits, daily_ai_tokens: 1000 }),
  ]);
  await as("", "service_role");
  await rpc("finish_agent", [id, job.lease, "Failed", null]);
  await as();
  await rpc("retry_agent", [wid, id]);
  const retry = await claim();
  await assert.rejects(
    rpc("reserve_agent_call", [id, retry.lease]),
    /Daily AI token limit/,
  );
});
test("upload reservations enforce concurrent quota and block direct unreserved storage writes", async (t) => {
  const { rpc, as, wid, team, db } = await fixture(t);
  await rpc("save_operations", [
    wid,
    JSON.stringify({ ...defaultLimits, asset_quota_bytes: 10485760 }),
  ]);
  await as(team);
  const a = crypto.randomUUID(),
    b = crypto.randomUUID();
  await rpc("reserve_asset_upload", [wid, "a", a, 7000000, "png"]);
  await assert.rejects(
    rpc("reserve_asset_upload", [wid, "a", b, 7000000, "png"]),
    /quota reached/,
  );
  await assert.rejects(
    rpc("reserve_asset_upload", [wid, "b", b, 1000, "png"]),
    /access denied/,
  );
  await assert.rejects(
    db.query(
      "insert into storage.objects(bucket_id,name) values('grailhiiv-assets',$1)",
      [`${wid}/a/unreserved.png`],
    ),
    /row-level security/,
  );
  await db.query(
    "insert into storage.objects(bucket_id,name) values('grailhiiv-assets',$1)",
    [`${wid}/a/${a}.png`],
  );
  await rpc("release_asset_upload", [wid, a]);
  await rpc("reserve_asset_upload", [wid, "a", b, 7000000, "png"]);
});
test("internal rules create visible follow-ups once, preserve existing tasks and recheck owner access", async (t) => {
  const { rpc, as, wid, owner, db } = await fixture(t);
  const rule = {
    name: "Follow up",
    client_id: "a",
    event: "lead_created",
    action: "followup",
    message: "Contact lead",
    interval_minutes: 60,
    due_days: 3,
    enabled: true,
  };
  await rpc("save_internal_rule", [wid, null, JSON.stringify(rule)]);
  const lead = {
    ...createSeed().leads[0],
    id: "new-lead",
    clientId: "a",
    task: "",
    due: "",
  };
  await rpc("commit_records", [
    wid,
    JSON.stringify([{ kind: "leads", id: lead.id, before: null, after: lead }]),
    null,
  ]);
  await as("", "service_role");
  assert.equal(await rpc("tick_internal_automations"), 1);
  assert.equal(await rpc("tick_internal_automations"), 0);
  await as(owner);
  const saved = (
    await db.query<{ payload: any }>(
      "select payload from public.records where kind='leads' and id='new-lead'",
    )
  ).rows[0].payload;
  assert.equal(saved.task, "Contact lead");
  assert.match(saved.due, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(
    (await db.query("select id from public.records where kind='tasks'")).rows
      .length,
    1,
  );
  const ruleId = await rpc("save_internal_rule", [
    wid,
    null,
    JSON.stringify({
      ...rule,
      name: "Scheduled note",
      event: "schedule",
      action: "activity",
    }),
  ]);
  await db.exec("reset role");
  await db.query(
    "update public.internal_rules set next_run=now()-interval '1 minute' where id=$1",
    [ruleId],
  );
  await db.query(
    "delete from public.workspace_members where workspace_id=$1 and user_id=$2",
    [wid, owner],
  );
  await as("", "service_role");
  assert.equal(await rpc("tick_internal_automations"), 0);
  assert.equal(
    (
      await db.query<{ status: string }>(
        "select status from public.internal_runs where rule_id=$1",
        [ruleId],
      )
    ).rows[0].status,
    "Failed",
  );
});
test("worker availability expires and thumbnails are bounded, rotated WebP previews", async () => {
  assert.equal(
    workerIsHealthy(
      { healthy: true, last_seen: new Date(100000).toISOString() },
      100100,
    ),
    true,
  );
  assert.equal(
    workerIsHealthy(
      { healthy: true, last_seen: new Date(0).toISOString() },
      100000,
    ),
    false,
  );
  const image = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: "#123456" },
  })
    .png()
    .toBuffer();
  const thumbnail = await createThumbnail(image, "image/png");
  assert.ok(thumbnail && thumbnail.length <= 131072);
  const meta = await sharp(thumbnail!).metadata();
  assert.equal(meta.format, "webp");
  assert.ok(meta.width! <= 384 && meta.height! <= 384);
  assert.equal(
    await createThumbnail(new Uint8Array(), "application/pdf"),
    null,
  );
  await assert.rejects(createThumbnail(new Uint8Array([1, 2]), "image/png"));
});
