import { test } from "node:test";
import assert from "node:assert/strict";
import { createSeed } from "../src/lib/data";
import {
  changePostStatus,
  monthCells,
  csv,
  isWorkspace,
} from "../src/lib/domain";
test("approval cannot schedule an undated post", () => {
  const post = createSeed().posts.find((p) => !p.date)!;
  assert.throws(
    () =>
      changePostStatus(
        { ...post, status: "Awaiting approval" },
        "Scheduled",
        true,
      ),
    /date and time/,
  );
});
test("clients requiring approval cannot schedule a draft directly", () => {
  const post = createSeed().posts.find((p) => p.date)!;
  assert.throws(
    () => changePostStatus({ ...post, status: "Draft" }, "Scheduled", true),
    /approval/,
  );
});
test("approved content keeps its client, caption and date", () => {
  const post = createSeed().posts.find(
    (p) => p.status === "Awaiting approval",
  )!;
  const scheduled = changePostStatus(post, "Scheduled", true);
  assert.equal(scheduled.clientId, post.clientId);
  assert.equal(scheduled.caption, post.caption);
  assert.equal(scheduled.date, post.date);
  assert.equal(post.status, "Awaiting approval");
});
test("published posts are immutable in the demo approval flow", () => {
  const post = createSeed().posts.find((p) => p.status === "Published")!;
  assert.throws(() => changePostStatus(post, "Draft", true), /Published/);
});
test("calendar correctly aligns October and leap-year February", () => {
  const october = monthCells(2026, 9);
  assert.equal(october[3], "2026-10-01");
  assert.equal(october[33], "2026-10-31");
  assert.equal(october.length, 35);
  assert.equal(monthCells(2024, 1).filter(Boolean).length, 29);
});
test("CSV handles punctuation and neutralizes spreadsheet formulas", () => {
  assert.equal(
    csv([['=HYPERLINK("bad")', "Hello, world", "a\nb"]]),
    '"\'=HYPERLINK(""bad"")","Hello, world","a\nb"',
  );
});
test("seed records are separate and saved workspace schema is checked", () => {
  const first = createSeed();
  first.clients[0].name = "Changed";
  assert.equal(createSeed().clients[0].name, "Coastal Studio");
  assert.equal(isWorkspace(first), true);
  assert.equal(isWorkspace({ version: 1 }), false);
});
