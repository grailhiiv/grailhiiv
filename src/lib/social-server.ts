import "server-only";
import { authenticated } from "./api";
import { metaConfig } from "./social-meta";
export async function socialOwner(workspaceId: string) {
  const { db, user } = await authenticated();
  const role = await db.rpc("workspace_role", { wid: workspaceId });
  if (role.error || role.data !== "owner") throw new Error("Only owners can manage social accounts.");
  return { db, user };
}
export function metaRedirect() {
  const origin = new URL(process.env.GRAILHIIV_SITE_URL || "http://127.0.0.1:3100");
  return new URL("/api/social/callback", origin).href;
}
export function requireMeta() {
  const cfg = metaConfig();
  if (!cfg.configured) throw new Error("Configure the Meta app ID, app secret and social encryption key first.");
  return cfg;
}
