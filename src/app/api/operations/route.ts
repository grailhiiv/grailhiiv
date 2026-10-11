import { z } from "zod";
import { authenticated, apiError, checkOrigin, requestBody } from "@/lib/api";
import { automationService } from "@/lib/n8n-service";
import { defaultLimits, limitsSchema, ruleSchema } from "@/lib/operations";
import { workerIsHealthy } from "@/lib/worker-monitor";

async function owner(wid: string) {
  const { db } = await authenticated();
  const { data, error } = await db.rpc("workspace_role", { wid });
  if (error || data !== "owner")
    throw new Error("Only owners can manage operations.");
  return db;
}
export async function GET(request: Request) {
  try {
    const wid = z
      .string()
      .uuid()
      .parse(new URL(request.url).searchParams.get("workspaceId"));
    const db = await owner(wid);
    const service = automationService();
    const results = await Promise.all([
      db
        .from("workspace_operations")
        .select(
          "hourly_ai_calls,daily_ai_tokens,daily_ai_budget,asset_quota_bytes,checkpoint_days,reasoning_effort",
        )
        .eq("workspace_id", wid)
        .maybeSingle(),
      db
        .from("agent_usage")
        .select(
          "input_tokens,output_tokens,reserved_tokens,estimated_cost,reserved_cost,created_at",
        )
        .eq("workspace_id", wid)
        .gte("created_at", new Date().toISOString().slice(0, 10) + "T00:00:00Z")
        .limit(200),
      db
        .from("internal_rules")
        .select("*")
        .eq("workspace_id", wid)
        .order("created_at", { ascending: false }),
      db
        .from("internal_runs")
        .select("id,status,detail,attempts,created_at")
        .eq("workspace_id", wid)
        .order("created_at", { ascending: false })
        .limit(50),
      service.from("worker_status").select("name,last_seen,healthy,error_code"),
      service
        .from("backup_runs")
        .select("id,status,detail,created_at")
        .order("created_at", { ascending: false })
        .limit(7),
      db
        .from("records")
        .select("payload")
        .eq("workspace_id", wid)
        .eq("kind", "assets"),
      db.rpc("operations_usage_summary", { wid }),
    ]);
    if (results.some((r) => r.error))
      throw new Error(
        "Operational storage unavailable. Apply the operations migration.",
      );
    return Response.json(
      {
        settings: results[0].data || defaultLimits,
        usage: results[1].data,
        totals: results[7].data,
        rules: results[2].data,
        runs: results[3].data,
        workers: results[4].data!.map((w) => ({
          ...w,
          available: workerIsHealthy(w),
        })),
        backups: results[5].data,
        assetsBytes:
          results[7].data?.asset_bytes ??
          results[6].data!.reduce(
            (n, r) =>
              n +
              (r.payload.uploaded
                ? r.payload.size + (r.payload.thumbnailSize || 0)
                : 0),
            0,
          ),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
const inputSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("limits"),
      workspaceId: z.string().uuid(),
      settings: limitsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("rule"),
      workspaceId: z.string().uuid(),
      ruleId: z.string().uuid().nullable(),
      rule: ruleSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("retry"),
      workspaceId: z.string().uuid(),
      runId: z.string().uuid(),
    })
    .strict(),
]);
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const input = inputSchema.parse(await requestBody(request));
    const db = await owner(input.workspaceId);
    const result =
      input.action === "limits"
        ? await db.rpc("save_operations", {
            wid: input.workspaceId,
            settings: input.settings,
          })
        : input.action === "rule"
          ? await db.rpc("save_internal_rule", {
              wid: input.workspaceId,
              rid: input.ruleId,
              rule: input.rule,
            })
          : await db.rpc("retry_internal_run", {
              wid: input.workspaceId,
              rid: input.runId,
            });
    if (result.error) throw new Error(result.error.message);
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
