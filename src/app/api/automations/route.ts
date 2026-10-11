import { authenticated, apiError, checkOrigin, requestBody } from "@/lib/api";
import { automationInput, n8nConfig } from "@/lib/n8n";
import { z } from "zod";

async function requireMember(workspaceId: string) {
  const { db, user } = await authenticated();
  const { data, error } = await db
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();
  if (error || !data || data.role === "client_reviewer")
    throw new Error("Automation access denied.");
  return { db, role: data.role };
}
export async function GET(request: Request) {
  try {
    const workspaceId = z
      .string()
      .uuid()
      .parse(new URL(request.url).searchParams.get("workspaceId"));
    const { db } = await requireMember(workspaceId);
    const config = n8nConfig();
    const [bindings, runs, reachable] = await Promise.all([
      db
        .from("automation_bindings")
        .select("automation_id,workflow_key")
        .eq("workspace_id", workspaceId),
      db
        .from("automation_runs")
        .select(
          "id,automation_id,status,detail,created_at,started_at,finished_at,execution_id",
        )
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(200),
      config
        ? fetch(`${config.base}/healthz`, {
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.timeout(2000),
          })
            .then((r) => r.ok)
            .catch(() => false)
        : false,
    ]);
    if (bindings.error || runs.error)
      throw new Error(
        "Automation storage unavailable. Apply the n8n bridge migration.",
      );
    return Response.json(
      {
        configured: Boolean(config && process.env.SUPABASE_SERVICE_ROLE_KEY),
        reachable,
        workflows:
          config?.workflows.map(({ key, label }) => ({ key, label })) || [],
        bindings: bindings.data,
        runs: runs.data,
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
    const input = automationInput.parse(await requestBody(request));
    const { db, role } = await requireMember(input.workspaceId);
    const config = n8nConfig();
    if (input.action === "bind") {
      if (role !== "owner")
        throw new Error("Only owners can connect workflows.");
      if (
        input.workflowKey &&
        !config?.workflows.some((w) => w.key === input.workflowKey)
      )
        throw new Error("Choose a configured workflow.");
      const { error } = await db.rpc("bind_automation", {
        wid: input.workspaceId,
        aid: input.automationId,
        workflow: input.workflowKey,
      });
      if (error) throw new Error(error.message);
      return Response.json({ ok: true });
    }
    if (!config || !process.env.SUPABASE_SERVICE_ROLE_KEY)
      throw new Error("n8n is not configured.");
    const { data: binding } = await db
      .from("automation_bindings")
      .select("workflow_key")
      .eq("workspace_id", input.workspaceId)
      .eq("automation_id", input.automationId)
      .single();
    if (!config.workflows.some((w) => w.key === binding?.workflow_key))
      throw new Error("Connect a configured workflow first.");
    const { data, error } = await db.rpc("enqueue_automation", {
      wid: input.workspaceId,
      aid: input.automationId,
      request_id: input.requestId,
    });
    if (error) throw new Error(error.message);
    return Response.json({ runId: data }, { status: 202 });
  } catch (e) {
    return apiError(e);
  }
}
