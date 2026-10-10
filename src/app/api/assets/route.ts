import { z } from "zod";
import { authenticated, apiError, checkOrigin } from "@/lib/api";
import { maxAssetBytes, validateAsset } from "@/lib/file-validation";
import type { Asset } from "@/lib/types";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db } = await authenticated();
    if (Number(request.headers.get("content-length")) > maxAssetBytes + 65536)
      throw new Error("Upload exceeds the 10 MB limit.");
    const form = await request.formData();
    const wid = z.string().uuid().parse(form.get("workspaceId"));
    const clientId = z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,100}$/)
      .parse(form.get("clientId"));
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a file.");
    const { data: role, error: roleError } = await db.rpc("workspace_role", {
      wid,
    });
    const { data: allowed, error: accessError } = await db.rpc(
      "can_access_client",
      { wid, cid: clientId },
    );
    if (
      roleError ||
      accessError ||
      !allowed ||
      !["owner", "team_member"].includes(role)
    )
      throw new Error("Upload access denied.");
    if (file.size > maxAssetBytes)
      throw new Error("Upload exceeds the 10 MB limit.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = validateAsset(bytes, file.type);
    const id = crypto.randomUUID();
    const storagePath = `${wid}/${clientId}/${id}.${extension}`;
    const result = await db.storage
      .from("grailhiiv-assets")
      .upload(storagePath, bytes, { contentType: file.type, upsert: false });
    if (result.error) throw new Error(result.error.message);
    const asset: Asset = {
      id,
      clientId,
      name: file.name.slice(0, 200),
      type: file.type,
      size: file.size,
      storagePath,
      url: `/api/assets/file?workspaceId=${wid}&id=${id}`,
      status: "Draft",
      tags: [],
      uploaded: true,
    };
    const saved = await db.rpc("commit_records", {
      wid,
      changes: [{ kind: "assets", id, before: null, after: asset }],
      prefs: null,
    });
    if (saved.error) {
      await db.storage.from("grailhiiv-assets").remove([storagePath]);
      throw new Error(saved.error.message);
    }
    return Response.json({ asset });
  } catch (e) {
    return apiError(e);
  }
}
