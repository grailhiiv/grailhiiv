import { z } from "zod";
import { serverSupabase } from "@/lib/supabase/server";
import { apiError, checkOrigin, requestBody, siteOrigin } from "@/lib/api";
import { NextResponse } from "next/server";
const schema = z
  .object({
    action: z.enum([
      "login",
      "signup",
      "recover",
      "password",
      "logout",
      "session",
    ]),
    email: z.string().email().optional(),
    password: z.string().min(1).max(128).optional(),
    accessToken: z.string().max(10000).optional(),
    refreshToken: z.string().max(2000).optional(),
  })
  .strict();
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const isForm = request.headers
      .get("content-type")
      ?.startsWith("application/x-www-form-urlencoded");
    const input = schema.parse(
      isForm
        ? Object.fromEntries((await request.formData()).entries())
        : await requestBody(request),
    );
    const db = await serverSupabase();
    const origin = siteOrigin(request);
    let error;
    switch (input.action) {
      case "session": {
        if (!input.accessToken || !input.refreshToken)
          throw new Error("This invitation or recovery link is invalid.");
        const result = await db.auth.setSession({
          access_token: input.accessToken,
          refresh_token: input.refreshToken,
        });
        if (result.error)
          throw new Error(
            "This invitation or recovery link has expired. Request a new email.",
          );
        const verified = await db.auth.getUser();
        if (verified.error || !verified.data.user)
          throw new Error("This invitation or recovery link is invalid.");
        break;
      }
      case "login":
        if (!input.email || !input.password)
          throw new Error("Email and password are required.");
        ({ error } = await db.auth.signInWithPassword({
          email: input.email,
          password: input.password,
        }));
        break;
      case "signup":
        if (!input.email || !input.password)
          throw new Error("Email and password are required.");
        if (input.password.length < 10)
          throw new Error("Use at least 10 characters for your password.");
        ({ error } = await db.auth.signUp({
          email: input.email,
          password: input.password,
          options: { emailRedirectTo: origin + "/auth/callback" },
        }));
        break;
      case "recover":
        if (!input.email) throw new Error("Enter your email address.");
        ({ error } = await db.auth.resetPasswordForEmail(input.email, {
          redirectTo: origin + "/auth/callback?next=/auth/password",
        }));
        break;
      case "password": {
        const {
          data: { user },
        } = await db.auth.getUser();
        if (!user)
          throw new Error("Open a valid invitation or recovery link first.");
        if (!input.password || input.password.length < 10)
          throw new Error("Enter a password of at least 10 characters.");
        ({ error } = await db.auth.updateUser({ password: input.password }));
        break;
      }
      case "logout":
        ({ error } = await db.auth.signOut({ scope: "local" }));
        break;
    }
    if (error) throw new Error(error.message);
    if (isForm)
      return NextResponse.redirect(
        new URL(
          input.action === "signup"
            ? "/login?notice=confirmation"
            : input.action === "recover"
              ? "/login?notice=recovery"
              : "/",
          origin,
        ),
        303,
      );
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
