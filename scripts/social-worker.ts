import { setTimeout as delay } from "node:timers/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { heartbeat } from "../src/lib/worker-monitor";
import { metaConfig, MetaError, openToken, publishMeta } from "../src/lib/social-meta";

export async function deliverJob(db: SupabaseClient, job: any) {
  let sending = false;
  try {
    const prepared = await db.rpc("prepare_publish_job", { jid: job.id, token: job.lease });
    if (prepared.error) throw new Error("Publishing validation failed.");
    if (!prepared.data) return;
    const credential = prepared.data, post = job.snapshot;
    let imageUrl: string | undefined;
    if (job.asset_snapshot) {
      const asset = job.asset_snapshot;
      if (!asset.storagePath || !asset.type?.startsWith("image/")) throw new MetaError("image_required");
      // Originals are never replaced by thumbnails; this release publishes one JPEG/PNG image.
      const file = await db.storage.from("grailhiiv-assets").download(asset.storagePath);
      if (file.error || !file.data) throw new MetaError("asset_unavailable");
      const metadata = await sharp(Buffer.from(await file.data.arrayBuffer()), { limitInputPixels: 25000000 }).metadata();
      if (!metadata.width || !metadata.height || !["jpeg", "png"].includes(metadata.format || "")) throw new MetaError("image_format_unsupported");
      if (post.platform === "Instagram" && (metadata.format !== "jpeg" || asset.size > 8000000 || metadata.width / metadata.height < 0.8 || metadata.width / metadata.height > 1.91)) throw new MetaError("instagram_image_requirements");
      const signed = await db.storage.from("grailhiiv-assets").createSignedUrl(asset.storagePath, 3600);
      if (signed.error || !signed.data?.signedUrl.startsWith("https://")) throw new MetaError("asset_unavailable");
      imageUrl = signed.data.signedUrl;
    }
    if (!post.caption?.trim() && !imageUrl) throw new MetaError("caption_required");
    if (post.platform === "Instagram" && post.caption.length > 2200) throw new MetaError("instagram_caption_too_long");
    const id = await publishMeta({ platform: post.platform, accountId: credential.account_id, token: openToken(credential.token_cipher, credential.context), caption: post.caption, imageUrl, containerId: job.container_id || undefined }, {
      saveContainer: async container => {
        const result = await db.rpc("prepare_publish_job", { jid: job.id, token: job.lease, container });
        if (result.error || !result.data) throw new MetaError("approval_changed");
      },
      beforeSend: async () => {
        // The persisted Sending state is the irreversible boundary. A crash here is held for review.
        const result = await db.rpc("prepare_publish_job", { jid: job.id, token: job.lease, send_now: true });
        if (result.error || !result.data) throw new MetaError("approval_changed");
        sending = true;
      },
    });
    const saved = await db.rpc("finish_publish_job", { jid: job.id, token: job.lease, result_state: "Published", remote_id: id, reason: "Provider confirmed delivery." });
    if (saved.error) throw new MetaError("receipt_not_saved", true);
  } catch (e) {
    const known = e instanceof MetaError;
    const state = known && e.code === "media_processing" && !sending ? "Queued" : (sending && (!known || e.uncertain)) ? "Needs review" : "Failed";
    const result = await db.rpc("finish_publish_job", { jid: job.id, token: job.lease, result_state: state, reason: known ? e.code : "publishing_unavailable" });
    if (result.error) console.error("Publishing result unavailable; delivery is held by its lease.");
  }
}
async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing worker configuration.");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let stopping = false;
  process.on("SIGTERM", () => { stopping = true; }); process.on("SIGINT", () => { stopping = true; });
  console.log("Social publishing worker started.");
  while (!stopping) {
    try {
      if (!metaConfig().configured) { await heartbeat(db, "social", false, "provider_or_job_failed"); await delay(15000); continue; }
      const queued = await db.rpc("queue_social_posts"); if (queued.error) throw queued.error;
      const claimed = await db.rpc("claim_publish_job"); if (claimed.error) throw claimed.error;
      if (claimed.data) await deliverJob(db, claimed.data);
      await heartbeat(db, "social");
    } catch { await heartbeat(db, "social", false, "database_unavailable"); console.error("Social publishing storage unavailable."); }
    await delay(10000);
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/social-worker.ts")) main().catch(() => { console.error("Social worker configuration invalid."); process.exitCode = 1; });
