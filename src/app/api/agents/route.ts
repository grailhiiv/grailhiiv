import { authenticated, apiError, checkOrigin, requestBody } from "@/lib/api";
import { agentInput, agentModels } from "@/lib/agent-config";
import { z } from "zod";

async function member(workspaceId: string) {
  const { db, user } = await authenticated();
  const { data, error } = await db
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();
  if (error || !data || !["owner", "team_member"].includes(data.role))
    throw new Error("AI agent access denied.");
  return db;
}
export async function GET(request: Request) {
  try {
    const wid = z
      .string()
      .uuid()
      .parse(new URL(request.url).searchParams.get("workspaceId"));
    const db = await member(wid);
    const columns =
      "id,client_id,model_key,brief,status,detail,proposal,created_at,finished_at";
    const [history, active] = await Promise.all([
      db
        .from("agent_runs")
        .select(columns)
        .eq("workspace_id", wid)
        .order("finished_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(50),
      db
        .from("agent_runs")
        .select(columns)
        .eq("workspace_id", wid)
        .in("status", ["Queued", "Running", "Awaiting approval"]),
    ]);
    if (history.error || active.error)
      throw new Error("AI storage unavailable. Apply the agent migration.");
    const configured = Boolean(
      process.env.GRAILHIIV_AI_DATABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
    return Response.json(
      {
        models: configured
          ? agentModels().map(({ key, label }) => ({ key, label }))
          : [],
        runs: [
          ...new Map(
            [...(active.data || []), ...(history.data || [])].map((r) => [
              r.id,
              r,
            ]),
          ).values(),
        ],
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const input = agentInput.parse(await requestBody(request));
    const db = await member(input.workspaceId);
    if (
      input.action === "edit" ||
      input.action === "regenerate" ||
      input.action === "retry"
    ) {
      const args =
        input.action === "edit"
          ? {
              wid: input.workspaceId,
              rid: input.runId,
              expected: input.expectedProposal,
              plan: input.proposal,
            }
          : input.action === "regenerate"
            ? {
                wid: input.workspaceId,
                rid: input.runId,
                idx: input.index,
                expected: input.expectedProposal,
                request_id: input.requestId,
              }
            : { wid: input.workspaceId, rid: input.runId };
      const { error } = await db.rpc(
        input.action === "edit"
          ? "edit_agent_plan"
          : input.action === "regenerate"
            ? "regenerate_agent_post"
            : "retry_agent",
        args,
      );
      if (error) throw new Error(error.message);
      return Response.json({ ok: true });
    }
    if (input.action === "decide") {
      const { error } = await db.rpc("decide_agent", {
        wid: input.workspaceId,
        run_id: input.runId,
        approved: input.approved,
        expected_plan: input.expectedProposal ?? null,
      });
      if (error) throw new Error(error.message);
      return Response.json({ ok: true });
    }
    const model = agentModels().find((m) => m.key === input.modelKey);
    if (
      !model ||
      !process.env.GRAILHIIV_AI_DATABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    )
      throw new Error("AI model and worker storage must be configured first.");
    const { data, error } = await db.rpc("enqueue_agent", {
      wid: input.workspaceId,
      cid: input.clientId,
      request_id: input.requestId,
      model_config: model,
      prompt: input.brief,
    });
    if (error) throw new Error(error.message);
    return Response.json({ runId: data }, { status: 202 });
  } catch (e) {
    return apiError(e);
  }
}
