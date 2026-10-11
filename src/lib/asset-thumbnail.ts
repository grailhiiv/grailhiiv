import sharp from "sharp";
export async function createThumbnail(bytes: Uint8Array, mime: string) {
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime))
    return null;
  let thumbnail = await sharp(bytes, {
    limitInputPixels: 25000000,
    animated: false,
  })
    .rotate()
    .resize(384, 384, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer();
  if (thumbnail.length > 131072)
    thumbnail = await sharp(bytes, {
      limitInputPixels: 25000000,
      animated: false,
    })
      .rotate()
      .resize(256, 256, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 60 })
      .toBuffer();
  if (thumbnail.length > 131072)
    throw new Error("Thumbnail processing exceeded its size limit.");
  return thumbnail;
}
