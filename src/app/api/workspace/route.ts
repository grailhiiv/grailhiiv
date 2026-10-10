import { authenticated, apiError, checkOrigin, requestBody } from "@/lib/api";
import { emptyWorkspace, type CloudSession } from "@/lib/cloud";
import {
  commitSchema,
  validateChanges,
  schemas,
  validateAssetStorage,
} from "@/lib/record-schema";
export async function GET(request: Request) {
  try {
    const { db, user } = await authenticated();
    const { error: claimError } = await db.rpc("accept_invitations");
    if (claimError) throw new Error(claimError.message);
    const { data: members, error } = await db
      .from("workspace_members")
      .select("workspace_id, role, notifications")
      .eq("user_id", user.id)
      .order("created_at");
    if (error) throw new Error(error.message);
    const wanted = new URL(request.url).searchParams.get("workspaceId");
    const member = wanted
      ? members?.find((m) => m.workspace_id === wanted)
      : members?.[0];
    if (!member)
      return Response.json(
        { session: null, email: user.email, workspaces: members || [] },
        { headers: { "Cache-Control": "no-store" } },
      );
    const workspaceId = member.workspace_id;
    const results = await Promise.all([
      db.from("workspaces").select("name").eq("id", workspaceId).single(),
      db.from("clients").select("payload").eq("workspace_id", workspaceId),
      db.from("records").select("kind,payload").eq("workspace_id", workspaceId),
      db
        .from("activity_log")
        .select("id,client_id,summary,created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    for (const result of results)
      if (result.error) throw new Error(result.error.message);
    const data = emptyWorkspace(results[0].data?.name);
    data.preferences.notifications = member.notifications;
    data.clients = results[1].data!.map((r) => schemas.clients.parse(r.payload));
    for (const r of results[2].data!) {
      if (r.kind === "tasks") continue;
      if (!["posts", "leads", "assets", "automations"].includes(r.kind))
        throw new Error("Invalid workspace record kind.");
      const kind = r.kind as "posts" | "leads" | "assets" | "automations";
      (data[kind] as unknown[]).push(schemas[kind].parse(r.payload));
    }
    for (const asset of data.assets) validateAssetStorage(workspaceId, asset);
    data.activities = results[3].data!.map((r) => ({
      id: r.id,
      clientId: r.client_id || "all",
      text: r.summary,
      date: r.created_at,
    }));
    const session: CloudSession = {
      email: user.email || "",
      userId: user.id,
      workspaceId,
      role: member.role,
    };
    return Response.json(
      { data, session, workspaces: members },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db } = await authenticated();
    const input = commitSchema.parse(await requestBody(request));
    validateChanges(input.changes, input.workspaceId);
    const { error } = await db.rpc("commit_records", {
      wid: input.workspaceId,
      changes: input.changes,
      prefs: input.preferences || null,
    });
    if (error) throw new Error(error.message);
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
