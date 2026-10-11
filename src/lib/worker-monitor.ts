import type { SupabaseClient } from "@supabase/supabase-js";
const pulses = new Map<
  string,
  { at: number; healthy: boolean; code: string }
>();
export async function heartbeat(
  db: SupabaseClient,
  name: "ai" | "n8n" | "internal" | "backup" | "social",
  healthy = true,
  code = "",
) {
  const previous = pulses.get(name);
  if (
    previous &&
    Date.now() - previous.at < 25000 &&
    previous.healthy === healthy &&
    previous.code === code
  )
    return;
  const { error } = await db.rpc("worker_heartbeat", {
    worker: name,
    ok: healthy,
    code,
  });
  if (!error) pulses.set(name, { at: Date.now(), healthy, code });
  if (error) console.error("Worker heartbeat could not be recorded.");
}
export function workerIsHealthy(
  row: { healthy: boolean; last_seen: string } | undefined,
  now = Date.now(),
) {
  return Boolean(
    row?.healthy &&
    Number.isFinite(Date.parse(row.last_seen)) &&
    now - Date.parse(row.last_seen) < 90_000,
  );
}
