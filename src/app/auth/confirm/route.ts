import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase/server";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (
    token_hash &&
    (type === "invite" || type === "recovery" || type === "email")
  ) {
    const db = await serverSupabase();
    const { error } = await db.auth.verifyOtp({ token_hash, type });
    if (!error)
      return NextResponse.redirect(
        new URL(type === "email" ? "/" : "/auth/password", url.origin),
      );
  }
  return NextResponse.redirect(
    new URL("/login?error=invalid_link", url.origin),
  );
}
