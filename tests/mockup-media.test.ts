import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { createSeed } from "../src/lib/data";
import { applyMockupMedia } from "../src/lib/mockup-media";
test("all 50 sample images retain the exact reference pixels", async () => {
  const records = JSON.parse(
    await readFile("public/media/mockup/provenance.json", "utf8"),
  );
  assert.equal(records.length, 50);
  for (const record of records) {
    const [expected, actual] = await Promise.all([
      sharp(record.source).extract(record.bounds).raw().toBuffer(),
      sharp(`public/media/mockup/${record.file}`).raw().toBuffer(),
    ]);
    assert.deepEqual(actual, expected, record.file);
  }
});
test("media migration preserves client edits, draft edits, notes, uploads and approval states", () => {
  const data = createSeed();
  data.clients[0].voice = "My edited voice";
  data.clients[0].logo = "";
  data.posts[0].caption = "My edited caption";
  data.posts[0].notes.push({ text: "Keep this", date: "2026-10-08" });
  data.assets[0].status = "Draft";
  data.assets.push({
    id: "my-upload",
    clientId: "coastal",
    name: "My photo.png",
    type: "image/png",
    size: 30,
    url: "",
    uploaded: true,
    status: "Draft",
    tags: [],
  });
  const next = applyMockupMedia(data);
  assert.equal(next.clients[0].voice, "My edited voice");
  assert.equal(next.clients[0].logo, "");
  assert.equal(next.posts[0].caption, "My edited caption");
  assert.equal(next.posts[0].notes[0].text, "Keep this");
  assert.equal(
    next.assets.find((a) => a.id === data.assets[0].id)?.status,
    "Draft",
  );
  assert.ok(next.assets.find((a) => a.id === "my-upload")?.uploaded);
  assert.equal(new Set(next.assets.map((a) => a.id)).size, next.assets.length);
});
