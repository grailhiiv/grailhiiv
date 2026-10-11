import { cookies } from "next/headers";
import { createHash, timingSafeEqual } from "node:crypto";
import { automationService } from "@/lib/n8n-service";
import { discoverPages, exchangeCode, graph, metaScopes, sealToken } from "@/lib/social-meta";
import { metaRedirect, requireMeta, socialOwner } from "@/lib/social-server";

export async function GET(request: Request) {
  const destination = new URL("/settings", metaRedirect());
  try {
    requireMeta();
    const url = new URL(request.url), state = url.searchParams.get("state") || "", code = url.searchParams.get("code");
    const nonce = (await cookies()).get("grailhiiv-meta-state")?.value || "";
    if (!/^[a-f0-9]{64}$/.test(state) || !/^[a-f0-9]{64}$/.test(nonce) || !timingSafeEqual(Buffer.from(state), Buffer.from(nonce)) || !code || url.searchParams.has("error")) throw new Error("Authorization failed.");
    const id = createHash("sha256").update(nonce).digest("hex"), service = automationService();
    const found = await service.from("social_oauth").select("workspace_id,actor_id,platform").eq("id", id).is("pages_cipher", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (!found.data) throw new Error("Authorization expired.");
    const { user } = await socialOwner(found.data.workspace_id);
    if (found.data.actor_id !== user.id) throw new Error("Authorization user changed.");
    // Consume before exchanging the single-use code; callback replay cannot overwrite tokens.
    const consumed = await service.from("social_oauth").update({ pages_cipher: "processing" }).eq("id", id).is("pages_cipher", null).select("id");
    if (consumed.error || consumed.data?.length !== 1) throw new Error("Authorization already used.");
    const token = await exchangeCode(code, metaRedirect());
    const permissions = await graph("me/permissions", token);
    const granted = new Set((permissions.data as { permission: string; status: string }[] || []).filter(p => p.status === "granted").map(p => p.permission));
    if (metaScopes.some(scope => !granted.has(scope))) throw new Error("Required publishing permissions were not granted.");
    const pages = await discoverPages(token);
    if (!pages.length) throw new Error("No Pages with publishing access.");
    // Recheck membership after provider calls; it may have changed during authorization.
    await socialOwner(found.data.workspace_id);
    const saved = await service.from("social_oauth").update({ pages_cipher: sealToken(JSON.stringify(pages), id) }).eq("id", id);
    if (saved.error) throw new Error("Account selection could not be stored.");
    destination.searchParams.set("social", "choose");
    destination.searchParams.set("platform", found.data.platform);
  } catch {
    destination.searchParams.set("social", "failed");
  }
  return Response.redirect(destination, 303);
}
