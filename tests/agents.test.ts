import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Command } from "@langchain/langgraph";
import { contentGraph } from "../src/lib/agent-graph";
import { agentModels, planSchema } from "../src/lib/agent-config";
import { createSeed } from "../src/lib/data";

const plan = planSchema.parse({
  posts: Array.from({ length: 5 }, (_, i) => ({
    title: `Idea ${i}`,
    caption: `Complete brand caption ${i}`,
    platform: "Instagram",
  })),
});
const model = {
  key: "test",
  label: "Test model",
  provider: "openai",
  model: "test-model",
  maxTokens: 4096,
};
test("AI model catalog validates limits and never exposes unconfigured providers", () => {
  assert.equal(
    agentModels({ GRAILHIIV_AI_MODELS: JSON.stringify([model]) }).length,
    0,
  );
  assert.equal(
    agentModels({
      GRAILHIIV_AI_MODELS: JSON.stringify([model]),
      OPENAI_API_KEY: "test",
    }).length,
    1,
  );
  assert.throws(() =>
    agentModels({ GRAILHIIV_AI_MODELS: JSON.stringify([model, model]) }),
  );
  assert.throws(() =>
    planSchema.parse({ posts: [{ ...plan.posts[0], status: "Published" }] }),
  );
});

test("Postgres checkpointer restores a proposal after worker recreation and gates the save tool", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  // Exercise the real PostgresSaver SQL/serialization with embedded PostgreSQL.
  const pool = {
    connect: async () => ({
      query: (sql: string, params?: unknown[]) => db.query(sql, params),
      release: () => {},
    }),
    query: (sql: string, params?: unknown[]) => db.query(sql, params),
    end: async () => {},
  };
  const saver = () =>
    new PostgresSaver(
      pool as unknown as ConstructorParameters<typeof PostgresSaver>[0],
      undefined,
      { schema: "agent_test" },
    );
  await saver().setup();
  let calls = 0,
    saves = 0;
  const tools = {
    context: async () => ({ name: "Test", voice: "Warm" }),
    generate: async () => {
      calls++;
      return plan;
    },
    save: async () => {
      saves++;
    },
  };
  const config = { configurable: { thread_id: crypto.randomUUID() } };
  await contentGraph(saver(), tools).invoke({ brief: "Write posts" }, config);
  assert.equal(saves, 0);
  assert.equal(calls, 1);
  const recreated = contentGraph(saver(), tools);
  const state = await recreated.getState(config);
  assert.deepEqual(state.values.plan, plan);
  assert.equal(state.tasks[0].interrupts?.length, 1);
  await recreated.invoke(new Command({ resume: { approved: true } }), config);
  assert.equal(saves, 1);
  assert.equal(calls, 1);
  const denied = { configurable: { thread_id: crypto.randomUUID() } };
  await recreated.invoke({ brief: "Other posts" }, denied);
  await contentGraph(saver(), tools).invoke(
    new Command({ resume: { approved: false } }),
    denied,
  );
  assert.equal(saves, 1);
});

test("agent database enforces scoped access, leases, human decisions, immutable drafts and recovery", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const [owner, team, reviewer, outsider] = [1, 2, 3, 4].map(
    (n) => `10000000-0000-4000-8000-00000000000${n}`,
  );
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,storage to authenticated,service_role;
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
    alter table storage.objects enable row level security;
    grant select,insert,delete on storage.objects to authenticated;`);
  for (const [i, id] of [owner, team, reviewer, outsider].entries())
    await db.query("insert into auth.users values($1,$2,now())", [
      id,
      `${["owner", "team", "reviewer", "outsider"][i]}@example.test`,
    ]);
  for (const name of [
    "202610090001_workspace.sql",
    "202610090002_storage.sql",
    "202610090003_atomic_import.sql",
    "20261009183529_harden_assets_and_posts.sql",
    "20261010120000_ai_agents.sql",
  ])
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  async function as(id: string, role = "authenticated") {
    await db.exec(`reset role; set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  }
  async function rpc(name: string, args: unknown[] = []) {
    return (
      await db.query<{ value: string }>(
        `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as value`,
        args,
      )
    ).rows[0]?.value;
  }
  await as(owner);
  const wid = await rpc("create_workspace", ["AI agency"]);
  await rpc("commit_records", [
    wid,
    JSON.stringify(
      createSeed()
        .clients.slice(0, 2)
        .map((c, i) => ({
          kind: "clients",
          id: i ? "b" : "a",
          before: null,
          after: { ...c, id: i ? "b" : "a" },
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
  const enqueue = (cid = "a", id = crypto.randomUUID()) =>
    rpc("enqueue_agent", [
      wid,
      cid,
      id,
      JSON.stringify(model),
      "Write five captions",
    ]);
  await assert.rejects(enqueue(), /access denied/);
  assert.equal(
    (await db.query("select id from public.agent_runs")).rows.length,
    0,
  );
  await as(outsider);
  await assert.rejects(enqueue(), /access denied/);
  await as(team);
  await assert.rejects(enqueue("b"), /access denied/);
  const id = crypto.randomUUID();
  await enqueue("a", id);
  assert.equal(await enqueue("a", id), id);
  await assert.rejects(enqueue(), /active AI run/);
  await assert.rejects(
    db.query("update public.agent_runs set status='Completed'"),
    /permission denied/,
  );
  await assert.rejects(
    db.query("select model_config from public.agent_runs"),
    /permission denied/,
  );
  await assert.rejects(rpc("claim_agent"), /permission denied/);
  await as("", "service_role");
  const claim = async () =>
    (
      await db.query<{ id: string; lease: string }>(
        "select * from public.claim_agent()",
      )
    ).rows[0];
  let job = await claim();
  assert.equal(job.id, id);
  assert.equal(await claim(), undefined);
  await assert.rejects(
    rpc("finish_agent", [id, job.lease, "Completed", null]),
    /Human draft acceptance required/,
  );
  await assert.rejects(
    rpc("finish_agent", [id, crypto.randomUUID(), "Failed", null]),
    /lease expired/,
  );
  await assert.rejects(
    rpc("finish_agent", [
      id,
      job.lease,
      "Awaiting approval",
      JSON.stringify({ posts: [{}] }),
    ]),
    /Invalid proposal/,
  );
  await rpc("finish_agent", [
    id,
    job.lease,
    "Awaiting approval",
    JSON.stringify(plan),
  ]);
  await as(reviewer);
  await assert.rejects(rpc("decide_agent", [wid, id, true]), /access denied/);
  await as(team);
  await rpc("decide_agent", [wid, id, true]);
  await rpc("decide_agent", [wid, id, true]);
  await assert.rejects(rpc("decide_agent", [wid, id, false]), /not waiting/);
  await as("", "service_role");
  job = await claim();
  await rpc("finish_agent", [id, job.lease, "Completed", null]);
  await assert.rejects(
    rpc("finish_agent", [id, job.lease, "Completed", null]),
    /lease expired/,
  );
  await as(owner);
  const posts = (
    await db.query<{ payload: { status: string; caption: string } }>(
      "select payload from public.records where kind='posts'",
    )
  ).rows;
  assert.equal(posts.length, 5);
  assert.ok(posts.every((p) => p.payload.status === "Draft"));
  assert.equal(posts[0].payload.caption, plan.posts[0].caption);
  assert.equal(
    (await db.query("select * from public.approvals")).rows.length,
    0,
  );
  await as(team);
  const rejected = await enqueue();
  await as("", "service_role");
  job = await claim();
  await rpc("finish_agent", [
    rejected,
    job.lease,
    "Awaiting approval",
    JSON.stringify(plan),
  ]);
  await as(team);
  await rpc("decide_agent", [wid, rejected, false]);
  await as("", "service_role");
  job = await claim();
  await rpc("finish_agent", [rejected, job.lease, "Rejected", null]);
  await as(owner);
  assert.equal(
    (await db.query("select id from public.records where kind='posts'")).rows
      .length,
    5,
  );
  await as(team);
  const recovering = await enqueue();
  await as("", "service_role");
  job = await claim();
  const stale = job.lease;
  await db.query(
    "update public.agent_runs set lease_until=now()-interval '1 second' where id=$1",
    [recovering],
  );
  job = await claim();
  assert.notEqual(job.lease, stale);
  await assert.rejects(
    rpc("agent_context", [recovering, stale]),
    /lease or access expired/,
  );
  await rpc("finish_agent", [
    recovering,
    job.lease,
    "Awaiting approval",
    JSON.stringify(plan),
  ]);
  await as(owner);
  await rpc("decide_agent", [wid, recovering, true]);
  await db.exec("reset role");
  await db.query(
    "delete from public.client_access where workspace_id=$1 and user_id=$2",
    [wid, team],
  );
  await as("", "service_role");
  assert.equal(await claim(), undefined);
  assert.equal(
    (
      await db.query<{ status: string }>(
        "select status from public.agent_runs where id=$1",
        [recovering],
      )
    ).rows[0].status,
    "Failed",
  );
  // Revoking the accepting team member after claim still blocks the write.
  await db.exec("reset role");
  await db.query("insert into public.client_access values($1,$2,'a')", [
    wid,
    team,
  ]);
  await as(owner);
  const lateRevocation = await enqueue();
  await as("", "service_role");
  job = await claim();
  await rpc("finish_agent", [
    lateRevocation,
    job.lease,
    "Awaiting approval",
    JSON.stringify(plan),
  ]);
  await as(team);
  await rpc("decide_agent", [wid, lateRevocation, true]);
  await as("", "service_role");
  job = await claim();
  await db.exec("reset role");
  await db.query(
    "delete from public.client_access where workspace_id=$1 and user_id=$2",
    [wid, team],
  );
  await as("", "service_role");
  await assert.rejects(
    rpc("finish_agent", [lateRevocation, job.lease, "Completed", null]),
    /Human draft acceptance required/,
  );
  await as(owner);
  assert.equal(
    (await db.query("select id from public.records where kind='posts'")).rows
      .length,
    5,
  );
});
