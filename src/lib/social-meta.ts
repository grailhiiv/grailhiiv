import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export const metaScopes = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish"];
export function metaConfig() {
  const appId = process.env.GRAILHIIV_META_APP_ID || "";
  const appSecret = process.env.GRAILHIIV_META_APP_SECRET || "";
  const key = process.env.GRAILHIIV_SOCIAL_ENCRYPTION_KEY || "";
  const version = process.env.GRAILHIIV_META_API_VERSION || "v25.0";
  if (!/^v\d+\.0$/.test(version)) throw new Error("Invalid Meta API version.");
  return { appId, appSecret, key, version, configured: /^\d+$/.test(appId) && Boolean(appSecret) && /^[a-f0-9]{64}$/i.test(key) };
}
function encryptionKey() {
  const { key } = metaConfig();
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error("Social encryption key is not configured.");
  return Buffer.from(key, "hex");
}
export function sealToken(value: string, context: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  return Buffer.concat([iv, cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64");
}
export function openToken(value: string, context: string) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 29) throw new Error("Invalid encrypted credential.");
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString("utf8");
}
export class MetaError extends Error {
  constructor(public code: string, public uncertain = false) { super(code); }
}
type GraphResult = { id?: string; post_id?: string; permalink?: string; status_code?: string; [key: string]: unknown };
export async function graph(path: string, token: string, params: Record<string, string> = {}, method = "GET", transport: typeof fetch = fetch): Promise<GraphResult> {
  if (!/^[a-zA-Z0-9_]+(?:\/[a-z_]+)?$/.test(path)) throw new Error("Invalid Graph path.");
  const config = metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.version}/${path}`);
  const form = new URLSearchParams(params);
  if (config.appSecret) form.set("appsecret_proof", createHmac("sha256", config.appSecret).update(token).digest("hex"));
  if (method === "GET") url.search = form.toString();
  let response: Response;
  try {
    response = await transport(url, { method, headers: { Authorization: `Bearer ${token}`, ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) }, ...(method === "POST" ? { body: form } : {}), signal: AbortSignal.timeout(30000), redirect: "error" });
  } catch { throw new MetaError("delivery_unknown", method === "POST"); }
  let body: GraphResult & { error?: { code?: number } };
  try { body = await response.json(); } catch { throw new MetaError("delivery_unknown", method === "POST"); }
  if (!response.ok || body.error) {
    // Do not persist provider messages: they can contain credentials or signed media URLs.
    const code = body.error?.code;
    throw new MetaError(code === 190 ? "reconnect_required" : code === 10 || code === 200 ? "permission_required" : "provider_rejected", response.status >= 500 && method === "POST");
  }
  return body;
}
export type MetaPage = { id: string; name: string; access_token: string; tasks: string[]; instagram_business_account?: { id: string } };
export async function discoverPages(token: string, transport: typeof fetch = fetch): Promise<MetaPage[]> {
  const pages: MetaPage[] = []; let after = "";
  for (let n = 0; n < 20; n++) {
    const result = await graph("me/accounts", token, { fields: "id,name,access_token,tasks,instagram_business_account", limit: "100", ...(after ? { after } : {}) }, "GET", transport);
    const rows = result.data as MetaPage[] | undefined;
    if (!Array.isArray(rows)) throw new MetaError("account_discovery_failed");
    pages.push(...rows.filter(p => /^\d+$/.test(p.id) && p.access_token && p.tasks?.some(task => ["CREATE_CONTENT", "MANAGE", "PROFILE_PLUS_CREATE_CONTENT", "PROFILE_PLUS_FULL_CONTROL"].includes(task))));
    const paging = result.paging as { next?: string; cursors?: { after?: string } } | undefined;
    if (!paging?.next) return pages;
    after = paging.cursors?.after || "";
    if (!after) throw new MetaError("account_discovery_failed");
  }
  throw new MetaError("too_many_accounts");
}
export async function exchangeCode(code: string, redirect: string, transport: typeof fetch = fetch) {
  const cfg = metaConfig();
  async function exchange(params: Record<string, string>) {
    // POST keeps the app secret and authorization code out of URL logs.
    try {
      const response = await transport(`https://graph.facebook.com/${cfg.version}/oauth/access_token`, { method: "POST", body: new URLSearchParams({ client_id: cfg.appId, client_secret: cfg.appSecret, ...params }), signal: AbortSignal.timeout(30000), redirect: "error" });
      const result = await response.json();
      if (!response.ok || typeof result.access_token !== "string") throw new Error();
      return result.access_token as string;
    } catch { throw new MetaError("authorization_failed"); }
  }
  const shortToken = await exchange({ redirect_uri: redirect, code });
  // Derive Page credentials from a long-lived user token instead of the short login token.
  return exchange({ grant_type: "fb_exchange_token", fb_exchange_token: shortToken });
}
export async function publishMeta(input: { platform: string; accountId: string; token: string; caption: string; imageUrl?: string; containerId?: string }, hooks: { saveContainer: (id: string) => Promise<void>; beforeSend: () => Promise<void> }, transport: typeof fetch = fetch) {
  let result: GraphResult;
  if (input.platform === "Facebook") {
    await hooks.beforeSend();
    result = await graph(input.accountId + (input.imageUrl ? "/photos" : "/feed"), input.token, input.imageUrl ? { url: input.imageUrl, caption: input.caption, published: "true" } : { message: input.caption }, "POST", transport);
  } else if (input.platform === "Instagram") {
    if (!input.imageUrl) throw new MetaError("instagram_image_required");
    let container = input.containerId;
    if (!container) {
      const created = await graph(input.accountId + "/media", input.token, { image_url: input.imageUrl, caption: input.caption }, "POST", transport);
      if (typeof created.id !== "string" || !/^\d+$/.test(created.id)) throw new MetaError("container_failed");
      container = created.id; await hooks.saveContainer(container);
    }
    const status = await graph(container, input.token, { fields: "status_code" }, "GET", transport);
    if (status.status_code === "IN_PROGRESS") throw new MetaError("media_processing");
    if (status.status_code !== "FINISHED") throw new MetaError("media_invalid");
    await hooks.beforeSend();
    result = await graph(input.accountId + "/media_publish", input.token, { creation_id: container }, "POST", transport);
  } else throw new MetaError("unsupported_platform");
  const id = result.post_id || result.id;
  if (typeof id !== "string" || !/^[0-9_]+$/.test(id)) throw new MetaError("delivery_unknown", true);
  return id;
}
