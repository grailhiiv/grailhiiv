import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasSupabase, supabaseConfig } from "@/lib/supabase/config";
export async function proxy(request: NextRequest) {
  // Machine callbacks authenticate with their per-run token, not browser cookies.
  if (request.nextUrl.pathname.startsWith("/api/automations/callback/")) return NextResponse.next();
  if (!hasSupabase()) return NextResponse.next();
  let response = NextResponse.next({ request });
  const { url, key } = supabaseConfig();
  const supabase = createServerClient(url, key, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.GRAILHIIV_SITE_URL?.startsWith("https://") || false,
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  await supabase.auth.getUser();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|media/|fonts/|favicon.ico).*)"],
};
