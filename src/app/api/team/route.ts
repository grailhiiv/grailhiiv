import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { authenticated, apiError, checkOrigin, requestBody } from "@/lib/api";
import { supabaseConfig } from "@/lib/supabase/config";
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().trim().min(1).max(200),
  }),
  z.object({
    action: z.literal("invite"),
    workspaceId: z.string().uuid(),
    email: z.string().email(),
    role: z.enum(["team_member", "client_reviewer"]),
    clientIds: z.array(z.string()).min(1).max(100),
    sendEmail: z.boolean(),
  }),
  z.object({
    action: z.literal("manage"),
    workspaceId: z.string().uuid(),
    userId: z.string().uuid(),
    role: z.enum(["owner", "team_member", "client_reviewer"]),
    clientIds: z.array(z.string()).max(100),
    remove: z.boolean(),
  }),
  z.object({
    action: z.literal("revoke"),
    workspaceId: z.string().uuid(),
    invitationId: z.string().uuid(),
  }),
]);
export async function GET(request: Request) {
  try {
    const { db } = await authenticated();
    const wid = z
      .string()
      .uuid()
      .parse(new URL(request.url).searchParams.get("workspaceId"));
    const { data: role } = await db.rpc("workspace_role", { wid });
    if (role !== "owner") throw new Error("Only owners can view team access.");
    const results = await Promise.all([
      db
        .from("workspace_members")
        .select("user_id,role")
        .eq("workspace_id", wid),
      db
        .from("client_access")
        .select("user_id,client_id")
        .eq("workspace_id", wid),
      db
        .from("workspace_invitations")
        .select("id,email,role,client_ids,expires_at,accepted_at")
        .eq("workspace_id", wid)
        .is("accepted_at", null),
    ]);
    for (const result of results)
      if (result.error) throw new Error(result.error.message);
    return Response.json(
      {
        members: results[0].data,
        access: results[1].data,
        invitations: results[2].data,
      },
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
    const input = schema.parse(await requestBody(request));
    if (input.action === "create") {
      const { data, error } = await db.rpc("create_workspace", {
        workspace_name: input.name,
      });
      if (error) throw new Error(error.message);
      return Response.json({ workspaceId: data });
    }
    if (input.action === "invite") {
      if (input.sendEmail && !process.env.SUPABASE_SERVICE_ROLE_KEY)
        throw new Error(
          "Invitation email requires the server-only Supabase service-role key. You can create a sign-in invitation link instead.",
        );
      const { data, error } = await db.rpc("create_invitation", {
        wid: input.workspaceId,
        invite_email: input.email,
        invite_role: input.role,
        assigned_clients: input.clientIds,
      });
      if (error) throw new Error(error.message);
      const origin = new URL(process.env.GRAILHIIV_SITE_URL || request.url)
        .origin;
      let emailError: string | null = null;
      if (input.sendEmail) {
        const { url } = supabaseConfig();
        const admin = createClient(
          url,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const result = await admin.auth.admin.inviteUserByEmail(input.email, {
          redirectTo: origin + "/auth/password",
        });
        if (result.error) emailError = result.error.message;
      }
      // No bearer invitation token: the invite is claimed only by its verified email owner.
      return Response.json({
        invitationId: data,
        link: origin + "/login",
        emailError,
      });
    }
    const result =
      input.action === "manage"
        ? await db.rpc("manage_member", {
            wid: input.workspaceId,
            member_id: input.userId,
            member_role: input.role,
            assigned_clients: input.clientIds,
            remove_member: input.remove,
          })
        : await db.rpc("revoke_invitation", {
            wid: input.workspaceId,
            invitation_id: input.invitationId,
          });
    if (result.error) throw new Error(result.error.message);
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
