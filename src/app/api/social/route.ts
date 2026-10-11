import { z } from "zod";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { apiError, checkOrigin, requestBody } from "@/lib/api";
import { automationService } from "@/lib/n8n-service";
import { graph, metaConfig, metaScopes, openToken, sealToken, type MetaPage } from "@/lib/social-meta";
import { metaRedirect, requireMeta, socialOwner } from "@/lib/social-server";
import { workerIsHealthy } from "@/lib/worker-monitor";

export async function GET(request: Request) {
  try {
    const wid = z.string().uuid().parse(new URL(request.url).searchParams.get("workspaceId"));
    const { db, user } = await socialOwner(wid), service = automationService();
    const [connections, jobs, worker] = await Promise.all([
      service.from("social_connections").select("id,client_id,platform,account_id,account_name,enabled").eq("workspace_id", wid),
      db.from("publish_jobs").select("id,client_id,post_id,snapshot,state,detail,provider_id,due_at,created_at").eq("workspace_id", wid).order("created_at", { ascending: false }).limit(100),
      service.from("worker_status").select("last_seen,healthy").eq("name", "social").maybeSingle(),
    ]);
    if (connections.error || jobs.error) throw new Error("Publishing storage unavailable. Apply the social publishing migration.");
    const cookie = (await cookies()).get("grailhiiv-meta-state")?.value;
    let pending: { id: string; name: string; instagram: boolean }[] = [], pendingClientId = "";
    if (cookie) {
      const found = await service.from("social_oauth").select("id,client_id,pages_cipher").eq("id", createHash("sha256").update(cookie).digest("hex")).eq("workspace_id", wid).eq("actor_id", user.id).gt("expires_at", new Date().toISOString()).maybeSingle();
      pendingClientId = found.data?.client_id || "";
      if (found.data?.pages_cipher && found.data.pages_cipher !== "processing") pending = (JSON.parse(openToken(found.data.pages_cipher, found.data.id)) as MetaPage[]).map(p => ({ id: p.id, name: p.name, instagram: Boolean(p.instagram_business_account?.id) }));
    }
    return Response.json({ configured: metaConfig().configured, workerAvailable: workerIsHealthy(worker.data || undefined), redirectUri: metaRedirect(), connections: connections.data, jobs: jobs.data, pending, pendingClientId }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return apiError(e); }
}
const base = { workspaceId: z.string().uuid() };
const schema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("connect"), clientId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), platform: z.enum(["Facebook", "Instagram"]) }).strict(),
  z.object({ ...base, action: z.literal("choose"), pageId: z.string().regex(/^\d+$/), platform: z.enum(["Facebook", "Instagram"]) }).strict(),
  z.object({ ...base, action: z.literal("account"), connectionId: z.string().uuid(), operation: z.enum(["enable", "disable", "disconnect"]) }).strict(),
  z.object({ ...base, action: z.literal("job"), jobId: z.string().uuid(), operation: z.enum(["retry", "cancel", "retry_uncertain", "dismiss_uncertain"]) }).strict(),
  z.object({ ...base, action: z.literal("receipt"), jobId: z.string().uuid(), providerId: z.string().regex(/^[0-9_]+$/).max(100) }).strict(),
]);
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const input = schema.parse(await requestBody(request));
    const { db, user } = await socialOwner(input.workspaceId);
    const service = automationService(), jar = await cookies();
    if (input.action === "connect") {
      const cfg = requireMeta();
      if (request.headers.get("origin") !== new URL(metaRedirect()).origin) throw new Error("Open the app at " + new URL(metaRedirect()).origin + " before connecting Meta accounts.");
      const client = await db.from("clients").select("id").eq("workspace_id", input.workspaceId).eq("id", input.clientId).maybeSingle();
      if (!client.data) throw new Error("Choose an existing client.");
      const nonce = randomBytes(32).toString("hex"), id = createHash("sha256").update(nonce).digest("hex");
      // A new flow replaces only this browser's unfinished authorization.
      const old = jar.get("grailhiiv-meta-state")?.value;
      if (old) await service.from("social_oauth").delete().eq("id", createHash("sha256").update(old).digest("hex")).eq("actor_id", user.id);
      const saved = await service.from("social_oauth").insert({ id, workspace_id: input.workspaceId, client_id: input.clientId, actor_id: user.id, platform: input.platform });
      if (saved.error) throw new Error("Could not start account authorization.");
      jar.set("grailhiiv-meta-state", nonce, { httpOnly: true, secure: metaRedirect().startsWith("https:"), sameSite: "lax", path: "/api/social", maxAge: 900 });
      const url = new URL(`https://www.facebook.com/${cfg.version}/dialog/oauth`);
      url.search = new URLSearchParams({ client_id: cfg.appId, redirect_uri: metaRedirect(), state: nonce, response_type: "code", scope: metaScopes.join(",") }).toString();
      return Response.json({ url: url.href });
    }
    if (input.action === "choose") {
      requireMeta();
      const nonce = jar.get("grailhiiv-meta-state")?.value;
      if (!nonce) throw new Error("Account authorization expired. Connect again.");
      const id = createHash("sha256").update(nonce).digest("hex");
      const found = await service.from("social_oauth").select("*").eq("id", id).eq("actor_id", user.id).eq("workspace_id", input.workspaceId).gt("expires_at", new Date().toISOString()).maybeSingle();
      if (!found.data?.pages_cipher) throw new Error("Account authorization expired. Connect again.");
      const page = (JSON.parse(openToken(found.data.pages_cipher, id)) as MetaPage[]).find(p => p.id === input.pageId);
      const account = input.platform === "Instagram" ? page?.instagram_business_account?.id : page?.id;
      if (!page || !account) throw new Error("Choose an authorized account for this platform.");
      const context = `${input.workspaceId}:${found.data.client_id}:${input.platform}`;
      const result = await service.rpc("save_social_connection", { wid: input.workspaceId, cid: found.data.client_id, actor: user.id, platform_name: input.platform, account, label: page.name, cipher: sealToken(page.access_token, context) });
      if (result.error) throw new Error(result.error.message);
      // Retain the selection briefly so the owner can connect both platforms from the same Page.
      return Response.json({ ok: true });
    }
    if (input.action === "receipt") {
      const job = await service.from("publish_jobs").select("*").eq("workspace_id", input.workspaceId).eq("id", input.jobId).eq("state", "Needs review").maybeSingle();
      if (!job.data?.connection_id) throw new Error("Reconnect the account before verifying this receipt.");
      const connected = await service.from("social_connections").select("*").eq("id", job.data.connection_id).eq("workspace_id", input.workspaceId).maybeSingle();
      if (!connected.data) throw new Error("Account unavailable.");
      const c = connected.data, token = openToken(c.token_cipher, `${input.workspaceId}:${c.client_id}:${c.platform}`);
      if (c.platform === "Facebook") {
        const remote = await graph(input.providerId, token, { fields: "id,from,message" });
        if ((remote.from as { id?: string })?.id !== c.account_id || (remote.message || "") !== job.data.snapshot.caption) throw new Error("Receipt does not match this account and caption.");
      } else {
        // Ownership is established by finding the ID under this account's media edge.
        let found = false, after = "";
        for (let page = 0; page < 10 && !found; page++) {
          const remote = await graph(c.account_id + "/media", token, { fields: "id,caption", limit: "100", ...(after ? { after } : {}) });
          found = (remote.data as { id: string; caption?: string }[] || []).some(m => m.id === input.providerId && (m.caption || "") === job.data.snapshot.caption);
          const paging = remote.paging as { next?: string; cursors?: { after?: string } } | undefined;
          if (!paging?.next) break; after = paging.cursors?.after || ""; if (!after) break;
        }
        if (!found) throw new Error("Receipt was not found under this Instagram account with the approved caption.");
      }
      await socialOwner(input.workspaceId);
      const saved = await service.rpc("finish_publish_job", { jid: input.jobId, token: job.data.lease, result_state: "Published", remote_id: input.providerId, reason: "Owner verified the provider receipt." });
      if (saved.error) throw new Error(saved.error.message);
      return Response.json({ ok: true });
    }
    const result = input.action === "account"
      ? await db.rpc("manage_social_connection", { wid: input.workspaceId, sid: input.connectionId, operation: input.operation })
      : await db.rpc("review_publish_job", { wid: input.workspaceId, jid: input.jobId, operation: input.operation });
    if (result.error) throw new Error(result.error.message);
    return Response.json({ ok: true });
  } catch (e) { return apiError(e); }
}
