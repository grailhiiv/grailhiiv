import "server-only";
import { serverSupabase } from "./supabase/server";
export async function authenticated() {
  const db = await serverSupabase();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new Error("Sign in to continue.");
  return { db, user: data.user };
}
export function checkOrigin(request: Request) {
  const allowed = new URL(process.env.GRAILHIIV_SITE_URL || request.url).origin;
  const origin = request.headers.get("origin");
  const loopback = new Set(["localhost", "127.0.0.1"]);
  const target = new URL(allowed);
  let localAlias = false;
  if (origin && loopback.has(target.hostname)) {
    const source = new URL(origin);
    localAlias =
      loopback.has(source.hostname) &&
      source.protocol === target.protocol &&
      source.port === target.port;
  }
  if (origin !== allowed && !localAlias)
    throw new Error("Request origin is not allowed.");
}
export function siteOrigin(request: Request) {
  const configured = new URL(process.env.GRAILHIIV_SITE_URL || request.url);
  const incoming = request.headers.get("origin");
  // Keep the PKCE verifier cookie and callback on the same local hostname.
  // Mutation handlers must validate the origin before using this helper.
  if (incoming && ["localhost", "127.0.0.1"].includes(configured.hostname)) {
    const candidate = new URL(incoming);
    if (
      ["localhost", "127.0.0.1"].includes(candidate.hostname) &&
      candidate.port === configured.port &&
      candidate.protocol === configured.protocol
    )
      return candidate.origin;
  }
  return configured.origin;
}
export async function requestBody(request: Request) {
  const raw = await request.text();
  if (raw.length > 2_000_000)
    throw new Error("Request exceeds the 2 MB limit.");
  return JSON.parse(raw);
}
export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed.";
  return Response.json(
    { error: message },
    {
      status: message === "Sign in to continue." ? 401 : 400,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
