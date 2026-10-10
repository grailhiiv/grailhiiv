export const maxAssetBytes = 10 * 1024 * 1024;
export function validateAsset(bytes: Uint8Array, type: string): string {
  if (!bytes.length || bytes.length > maxAssetBytes)
    throw new Error("Upload a file between 1 byte and 10 MB.");
  const starts = (...values: number[]) =>
    values.every((v, i) => bytes[i] === v);
  const text = (start: number, end: number) =>
    new TextDecoder().decode(bytes.slice(start, end));
  if (type === "image/png" && starts(137, 80, 78, 71, 13, 10, 26, 10))
    return "png";
  if (type === "image/jpeg" && starts(255, 216, 255)) return "jpg";
  if (type === "image/gif" && ["GIF87a", "GIF89a"].includes(text(0, 6)))
    return "gif";
  if (type === "image/webp" && text(0, 4) === "RIFF" && text(8, 12) === "WEBP")
    return "webp";
  if (type === "application/pdf" && text(0, 5) === "%PDF-") return "pdf";
  if (type === "video/mp4" && text(4, 8) === "ftyp") return "mp4";
  throw new Error(
    "The file content must match PNG, JPG, WebP, GIF, MP4 or PDF. SVG and executable files are not accepted.",
  );
}
