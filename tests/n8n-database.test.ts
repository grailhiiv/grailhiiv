import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createSeed } from "../src/lib/data";

test("automation queue enforces permissions, idempotency, dispatch revocation and immutable results", async (t) => {
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
    "20261010071129_n8n_automation_bridge.sql",
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
  const wid = await rpc("create_workspace", ["Automation agency"]);
  const clients = createSeed()
    .clients.slice(0, 2)
    .map((c, i) => ({ ...c, id: i ? "b" : "a" }));
  const automation = {
    id: "auto-a",
    name: "Connection check",
    clientId: "a",
    trigger: "Manual",
    enabled: true,
    runs: [],
  };
  await rpc("commit_records", [
    wid,
    JSON.stringify([
      ...clients.map((c) => ({
        kind: "clients",
        id: c.id,
        before: null,
        after: c,
      })),
      {
        kind: "automations",
        id: automation.id,
        before: null,
        after: automation,
      },
      {
        kind: "automations",
        id: "auto-b",
        before: null,
        after: { ...automation, id: "auto-b", clientId: "b" },
      },
    ]),
    null,
  ]);
  await rpc("bind_automation", [wid, "auto-a", "check"]);
  await rpc("bind_automation", [wid, "auto-b", "check"]);
  for (const [email, role] of [
    ["team@example.test", "team_member"],
    ["reviewer@example.test", "client_reviewer"],
  ])
    await rpc("create_invitation", [wid, email, role, ["a"]]);
  await as(team);
  await rpc("accept_invitations");
  await as(reviewer);
  await rpc("accept_invitations");
  await assert.rejects(
    rpc("enqueue_automation", [wid, "auto-a", crypto.randomUUID()]),
    /access denied/,
  );
  assert.equal(
    (await db.query("select * from public.automation_bindings")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("select * from public.automation_runs")).rows.length,
    0,
  );
  await as(team);
  assert.equal(
    (await db.query("select * from public.automation_bindings")).rows.length,
    1,
  );
  await assert.rejects(
    rpc("bind_automation", [wid, "auto-a", "other"]),
    /Only owners/,
  );
  await assert.rejects(
    rpc("enqueue_automation", [wid, "auto-b", crypto.randomUUID()]),
    /Client access denied/,
  );
  const requestId = crypto.randomUUID();
  assert.equal(
    await rpc("enqueue_automation", [wid, "auto-a", requestId]),
    requestId,
  );
  assert.equal(
    await rpc("enqueue_automation", [wid, "auto-a", requestId]),
    requestId,
  );
  await assert.rejects(
    rpc("enqueue_automation", [wid, "auto-a", crypto.randomUUID()]),
    /active run/,
  );
  await assert.rejects(
    db.query("update public.automation_runs set status='Success'"),
    /permission denied/,
  );
  await assert.rejects(rpc("claim_automation"), /permission denied/);
  await assert.rejects(
    rpc("finish_automation", [requestId, "Success", "Forged", "1"]),
    /permission denied/,
  );
  await as(owner);
  await assert.rejects(
    rpc("bind_automation", [wid, "auto-a", null]),
    /active run/,
  );
  await as(outsider);
  assert.equal(
    (await db.query("select * from public.automation_runs")).rows.length,
    0,
  );
  await assert.rejects(
    rpc("enqueue_automation", [wid, "auto-a", requestId]),
    /access denied/,
  );
  await as("", "service_role");
  const claimed = await db.query<{ id: string }>(
    "select * from public.claim_automation()",
  );
  assert.equal(claimed.rows[0].id, requestId);
  assert.equal(
    (await db.query("select * from public.claim_automation()")).rows.length,
    0,
  );
  await rpc("finish_automation", [requestId, "Success", "Verified", "17"]);
  await rpc("finish_automation", [
    requestId,
    "Success",
    "Duplicate ignored",
    "17",
  ]);
  await assert.rejects(
    rpc("finish_automation", [requestId, "Failed", "Overwrite", "18"]),
    /cannot accept/,
  );
  assert.equal(
    (
      await db.query<{ detail: string }>(
        "select detail from public.automation_runs where id=$1",
        [requestId],
      )
    ).rows[0].detail,
    "Verified",
  );
  // A member removed after enqueue cannot dispatch an external action.
  await as(team);
  const revokedId = crypto.randomUUID();
  await rpc("enqueue_automation", [wid, "auto-a", revokedId]);
  await as(owner);
  await rpc("manage_member", [wid, team, "team_member", [], true]);
  await as("", "service_role");
  assert.equal(
    (await db.query("select * from public.claim_automation()")).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query<{ status: string }>(
        "select status from public.automation_runs where id=$1",
        [revokedId],
      )
    ).rows[0].status,
    "Failed",
  );
  // Late callbacks and expired jobs never rewrite or redispatch an ambiguous execution.
  await as(owner);
  const expiredId = crypto.randomUUID();
  await rpc("enqueue_automation", [wid, "auto-a", expiredId]);
  await as("", "service_role");
  await db.query("select * from public.claim_automation()");
  await db.query(
    "update public.automation_runs set started_at=now()-interval '16 minutes' where id=$1",
    [expiredId],
  );
  await assert.rejects(
    rpc("finish_automation", [expiredId, "Success", "Late", "19"]),
    /cannot accept/,
  );
  await db.query("select * from public.claim_automation()");
  assert.equal(
    (
      await db.query<{ status: string }>(
        "select status from public.automation_runs where id=$1",
        [expiredId],
      )
    ).rows[0].status,
    "Unknown",
  );
  assert.equal(
    (await db.query("select * from public.claim_automation()")).rows.length,
    0,
  );
  await as(owner);
  const disabledId = crypto.randomUUID();
  await rpc("enqueue_automation", [wid, "auto-a", disabledId]);
  await rpc("commit_records", [
    wid,
    JSON.stringify([
      {
        kind: "automations",
        id: "auto-a",
        before: automation,
        after: { ...automation, enabled: false },
      },
    ]),
    null,
  ]);
  await as("", "service_role");
  assert.equal(
    (await db.query("select * from public.claim_automation()")).rows.length,
    0,
  );
  await as(owner);
  await assert.rejects(
    rpc("enqueue_automation", [wid, "auto-a", crypto.randomUUID()]),
    /Enable this automation/,
  );
  await rpc("bind_automation", [wid, "auto-a", null]);
});
