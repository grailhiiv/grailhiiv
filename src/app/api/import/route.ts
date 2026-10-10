import { z } from "zod";
import { authenticated, apiError, checkOrigin, requestBody } from "@/lib/api";
import { schemas } from "@/lib/record-schema";
const inputSchema = z.object({
  workspaceId: z.string().uuid(),
  data: z.object({
    version: z.literal(1),
    clients: z.array(schemas.clients).max(100),
    posts: z.array(schemas.posts).max(500),
    leads: z.array(schemas.leads).max(500),
    assets: z.array(schemas.assets).max(500),
    automations: z.array(schemas.automations).max(100),
  }),
});
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db } = await authenticated();
    const { workspaceId, data } = inputSchema.parse(await requestBody(request));
    const { data: role } = await db.rpc("workspace_role", { wid: workspaceId });
    if (role !== "owner")
      throw new Error("Only owners can import browser records.");
    const results = await Promise.all([
      db.from("clients").select("id").eq("workspace_id", workspaceId),
      db.from("records").select("kind,id").eq("workspace_id", workspaceId),
    ]);
    for (const r of results) if (r.error) throw new Error(r.error.message);
    if (results.some((r) => r.data?.length))
      throw new Error(
        "Import requires an empty workspace. Existing records will not be overwritten.",
      );
    const sharedAssets = data.assets.filter((a) => !a.uploaded);
    const sharedIds = new Set(sharedAssets.map((a) => a.id));
    const changes = [
      ...data.clients.map((after) => ({
        kind: "clients",
        id: after.id,
        before: null,
        after,
      })),
      ...sharedAssets.map((after) => ({
        kind: "assets",
        id: after.id,
        before: null,
        after,
      })),
      ...data.posts.map((post) => ({
        kind: "posts",
        id: post.id,
        before: null,
        after: {
          ...post,
          status: "Draft",
          metrics: undefined,
          assetId: sharedIds.has(post.assetId) ? post.assetId : "",
        },
      })),
      ...data.leads.map((after) => ({
        kind: "leads",
        id: after.id,
        before: null,
        after,
      })),
      ...data.automations
        .filter((a) => a.clientId !== "all")
        .map((after) => ({
          kind: "automations",
          id: after.id,
          before: null,
          after: { ...after, enabled: false, runs: [] },
        })),
    ];
    if (changes.length > 500)
      throw new Error("Import is limited to 500 total records.");
    const { error } = await db.rpc("import_records", {
      wid: workspaceId,
      changes,
    });
    if (error) throw new Error(error.message);
    return Response.json({
      imported: changes.length,
      skippedFiles: data.assets.length - sharedAssets.length,
    });
  } catch (e) {
    return apiError(e);
  }
}
