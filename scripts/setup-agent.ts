import { agentCheckpoints } from "../src/lib/agent-checkpoints";
import pg from "pg";
async function main() {
  const saver = agentCheckpoints();
  const pool = new pg.Pool({
    connectionString: process.env.GRAILHIIV_AI_DATABASE_URL,
  });
  try {
    // Harden the schema before creating tables, including default privileges.
    await pool.query(`create schema if not exists grailhiiv_agent;
      revoke all on schema grailhiiv_agent from public;
      alter default privileges in schema grailhiiv_agent revoke all on tables from public;
      do $$ declare r text; begin
        for r in select rolname from pg_roles where rolname in ('anon','authenticated') loop
          execute format('revoke all on schema grailhiiv_agent from %I',r);
          execute format('alter default privileges in schema grailhiiv_agent revoke all on tables from %I',r);
        end loop;
      end $$;`);
    await saver.setup();
    await pool.query(`revoke all on all tables in schema grailhiiv_agent from public;
      do $$ declare r text; begin
        for r in select rolname from pg_roles where rolname in ('anon','authenticated') loop
          execute format('revoke all on all tables in schema grailhiiv_agent from %I',r);
        end loop;
      end $$;`);
    console.log("Private AI checkpoint tables ready.");
  } finally {
    await saver.end();
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Checkpoint setup failed. Check the database connection and schema permissions.",
  );
  process.exitCode = 1;
});
