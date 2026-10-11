import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { heartbeat } from "../src/lib/worker-monitor";
async function main() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  )
    throw new Error("Missing worker settings.");
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  let stopping = false,
    cleanupAt = 0;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });
  console.log("Internal automation worker started.");
  while (!stopping) {
    try {
      const result = await db.rpc("tick_internal_automations");
      if (result.error) throw result.error;
      if (Date.now() - cleanupAt > 600000) {
        const expired = await db.rpc("expired_asset_uploads");
        if (expired.error) throw expired.error;
        for (const row of expired.data || []) {
          const removed = await db.storage
            .from("grailhiiv-assets")
            .remove(row.paths);
          if (!removed.error)
            await db.from("asset_uploads").delete().eq("id", row.id);
        }
        // Successful uploads with an interrupted reservation-release still expire.
        const committed = await db
          .from("asset_uploads")
          .select("id,workspace_id")
          .lt("expires_at", new Date().toISOString())
          .limit(50);
        for (const row of committed.data || []) {
          const record = await db
            .from("records")
            .select("id")
            .eq("workspace_id", row.workspace_id)
            .eq("kind", "assets")
            .eq("id", row.id)
            .maybeSingle();
          if (record.data)
            await db.from("asset_uploads").delete().eq("id", row.id);
        }
        cleanupAt = Date.now();
      }
      await heartbeat(db, "internal");
    } catch {
      await heartbeat(db, "internal", false, "database_unavailable");
      console.error("Internal automation storage unavailable.");
    }
    await delay(10000);
  }
}
main().catch(() => {
  console.error("Internal worker configuration invalid.");
  process.exitCode = 1;
});
