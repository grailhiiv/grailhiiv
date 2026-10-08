import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// GrailHiiv sample media: exact pixels from the user-approved mockups.
// No regeneration, retouching, or replacement photography is used.
const crops = {
  overview: [
    ["overview-skincare", 297, 530, 253, 102],
    ["overview-clinic", 572, 530, 250, 102],
    ["overview-coffee", 841, 530, 247, 102],
    ["attention-palm", 594, 258, 46, 38],
    ["attention-palm-2", 648, 258, 43, 38],
    ["attention-linen", 700, 258, 41, 38],
  ],
  "asset-library": [
    ["skincare", 489, 239, 220, 147],
    ["coffee", 735, 240, 211, 146],
    ["clinic", 974, 239, 213, 147],
    ["beach", 489, 509, 220, 146],
    ["dental-logo", 731, 509, 221, 146],
    ["morning-routine", 974, 509, 211, 145],
    ["wellness", 489, 778, 220, 114],
    ["brunch", 731, 778, 222, 114],
    ["coast", 974, 778, 213, 114],
    ["coffee-detail", 1228, 177, 276, 186],
  ],
  approvals: [
    ["approval-coffee", 664, 277, 288, 540],
    ["approval-patient", 289, 328, 82, 87],
    ["approval-yoga", 289, 459, 82, 87],
    ["approval-coast", 289, 590, 82, 87],
    ["approval-tools", 289, 723, 82, 87],
    ["approval-smoothie", 289, 853, 82, 87],
    ["jamie-avatar", 985, 588, 33, 33],
    ["reviewer-avatar", 985, 670, 33, 33],
  ],
  "content-calendar": [
    ["calendar-skincare", 834, 425, 44, 44],
    ["calendar-team", 978, 425, 45, 44],
    ["calendar-coffee", 1118, 425, 44, 44],
    ["calendar-palm", 280, 578, 44, 44],
    ["calendar-wellness", 558, 578, 44, 44],
    ["calendar-smile", 835, 578, 44, 44],
    ["calendar-product", 419, 732, 43, 44],
    ["calendar-brush", 697, 732, 44, 44],
    ["calendar-latte", 978, 732, 43, 44],
    ["calendar-coast", 419, 887, 43, 44],
    ["calendar-selfcare", 697, 887, 44, 44],
    ["calendar-patient", 978, 887, 43, 44],
    ["idea-palm", 1286, 327, 53, 58],
    ["idea-routine", 1286, 420, 53, 60],
    ["idea-brush", 1286, 513, 53, 60],
  ],
  "leads-crm": [
    ["emily-avatar", 1238, 101, 76, 76],
    ["sam-avatar", 1396, 13, 32, 32],
    ["agent-avatar", 287, 709, 31, 32],
  ],
  settings: [
    ["coastal-logo", 610, 236, 93, 96],
    ["northside-logo", 314, 315, 54, 54],
    ["bloom-logo", 314, 395, 54, 54],
    ["alex-avatar", 1066, 883, 32, 33],
  ],
  reports: [
    ["report-cafe", 297, 754, 51, 41],
    ["report-villas", 297, 811, 51, 41],
    ["report-interior", 297, 868, 51, 41],
    ["report-resort", 297, 925, 51, 41],
  ],
};
const out = path.resolve("public/media/mockup");
await mkdir(out, { recursive: true });
const manifest = [];
for (const [source, entries] of Object.entries(crops))
  for (const [name, left, top, width, height] of entries) {
    const file = `${name}.png`;
    await sharp(`design/mockups/${source}.png`)
      .extract({ left, top, width, height })
      .png()
      .toFile(path.join(out, file));
    manifest.push({
      file,
      source: `design/mockups/${source}.png`,
      bounds: { left, top, width, height },
    });
  }
await writeFile(
  path.join(out, "provenance.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(`Extracted ${manifest.length} unchanged sample images.`);
