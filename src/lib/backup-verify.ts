import { PGlite } from "@electric-sql/pglite";
import { z } from "zod";
const snapshotSchema = z
  .object({
    version: z.literal(1),
    tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  })
  .passthrough();
export async function verifyApplicationRestore(value: unknown) {
  const snapshot = snapshotSchema.parse(value);
  for (const table of [
    "workspaces",
    "workspace_members",
    "clients",
    "client_access",
    "records",
    "approvals",
    "activity_log",
    "workspace_invitations",
    "automation_bindings",
    "automation_runs",
    "agent_runs",
    "workspace_operations",
    "agent_usage",
    "internal_rules",
    "internal_runs",
    "auth_users",
    "auth_identities",
  ])
    if (!snapshot.tables[table])
      throw new Error("Application snapshot is incomplete.");
  const db = new PGlite();
  try {
    await db.exec(
      "create table restored_rows(kind text not null, data jsonb not null)",
    );
    for (const [kind, rows] of Object.entries(snapshot.tables))
      for (const row of rows)
        await db.query("insert into restored_rows values($1,$2)", [
          kind,
          JSON.stringify(row),
        ]);
    const invalid = await db.query<{
      count: number;
    }>(`select count(*)::integer as count from restored_rows r where
      (r.kind<>'workspaces' and r.data ? 'workspace_id' and not exists(select 1 from restored_rows w where w.kind='workspaces' and w.data->>'id'=r.data->>'workspace_id'))
      or (r.kind in ('records','client_access','approvals','agent_runs','automation_runs','automation_bindings','internal_rules','internal_runs','social_connections','publish_jobs') and r.data ? 'client_id'
      and not exists(select 1 from restored_rows c where c.kind='clients' and c.data->>'workspace_id'=r.data->>'workspace_id' and c.data->>'id'=r.data->>'client_id'))
      or (r.kind='workspace_members' and not exists(select 1 from restored_rows u where u.kind='auth_users' and u.data->>'id'=r.data->>'user_id'))
      or (r.kind='agent_usage' and r.data->>'run_id' is not null and not exists(select 1 from restored_rows a where a.kind='agent_runs' and a.data->>'id'=r.data->>'run_id'))
      or (r.kind='internal_runs' and not exists(select 1 from restored_rows a where a.kind='internal_rules' and a.data->>'id'=r.data->>'rule_id'))
      or (r.kind='publish_jobs' and not exists(select 1 from restored_rows a where a.kind='approvals' and a.data->>'id'=r.data->>'approval_id'))
      or (r.kind='publish_jobs' and r.data->>'connection_id' is not null and not exists(select 1 from restored_rows a where a.kind='social_connections' and a.data->>'id'=r.data->>'connection_id'))`);
    if (invalid.rows[0].count)
      throw new Error("Restored application references are inconsistent.");
    const count = await db.query<{ count: number }>(
      "select count(*)::integer as count from restored_rows",
    );
    return count.rows[0].count;
  } finally {
    await db.close();
  }
}
