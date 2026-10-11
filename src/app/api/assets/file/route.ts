import { z } from "zod";
import { authenticated, apiError } from "@/lib/api";
import { schemas, validateAssetStorage } from "@/lib/record-schema";
export async function GET(request: Request) {
  try {
    const { db } = await authenticated();
    const url = new URL(request.url);
    const wid = z.string().uuid().parse(url.searchParams.get("workspaceId"));
    const id = z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,100}$/)
      .parse(url.searchParams.get("id"));
    const { data, error } = await db
      .from("records")
      .select("payload")
      .eq("workspace_id", wid)
      .eq("kind", "assets")
      .eq("id", id)
      .single();
    if (error || !data?.payload.storagePath)
      throw new Error("Asset is unavailable or access is denied.");
    const asset = schemas.assets.parse(data.payload);
    validateAssetStorage(wid, asset);
    const result = await db.storage
      .from("grailhiiv-assets")
      .createSignedUrl(
        url.searchParams.has("thumbnail") &&
          asset.thumbnailPath &&
          !url.searchParams.has("download")
          ? asset.thumbnailPath
          : asset.storagePath!,
        60,
        url.searchParams.has("download") ? { download: asset.name } : {},
      );
    if (result.error) throw new Error(result.error.message);
    return new Response(null, {
      status: 302,
      headers: {
        Location: result.data.signedUrl,
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
