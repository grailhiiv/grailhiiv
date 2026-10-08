import { test, expect } from "@playwright/test";
test("all pages render without runtime errors and fit desktop", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const [route, title] of [
    ["/", "Overview"],
    ["/calendar", "Content calendar"],
    ["/approvals", "Approvals"],
    ["/leads", "Leads & CRM"],
    ["/automations", "Automations"],
    ["/assets", "Asset library"],
    ["/reports", "Reports"],
    ["/settings", "Settings"],
  ]) {
    await page.goto(route);
    await expect(
      page.getByRole("heading", { name: title, exact: true, level: 1 }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
  }
  expect(errors).toEqual([]);
});
test("create, submit, approve and persist a post across reload", async ({
  page,
}) => {
  await page.goto("/calendar");
  await page
    .getByRole("button", { name: "Create content", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Post title").fill("October launch test");
  await modal.getByLabel("Caption").fill("A real editable draft.");
  await modal.getByLabel("Publishing date (optional)").fill("2026-10-18");
  await modal.getByLabel("Time", { exact: true }).fill("10:30");
  await modal.getByRole("button", { name: "Save draft" }).click();
  await page
    .getByRole("button")
    .filter({ hasText: "October launch test" })
    .click();
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await page.goto("/approvals");
  await page
    .getByRole("button")
    .filter({ hasText: "October launch test" })
    .click();
  await page.getByRole("button", { name: "Approve & schedule" }).click();
  await page.getByRole("button", { name: /^Approved/ }).click();
  await expect(page.locator(".approval-queue")).toContainText(
    "October launch test",
  );
  await page.reload();
  await page.getByRole("button", { name: /^Approved/ }).click();
  await expect(page.locator(".approval-queue")).toContainText(
    "October launch test",
  );
});
test("client filters apply to leads and content", async ({ page }) => {
  await page.goto("/leads");
  await page.getByLabel("Selected client").selectOption("bloom");
  await expect(page.locator(".lead-card")).toHaveCount(5);
  await expect(page.locator(".lead-card")).not.toContainText([
    "Northside Dental",
  ]);
  await page.goto("/calendar");
  await expect(page.getByLabel("Selected client")).toHaveValue("bloom");
  await expect(page.locator(".calendar-client")).not.toContainText([
    "Coastal Studio",
  ]);
});
test("lead stage, note and follow-up updates persist", async ({ page }) => {
  await page.goto("/leads");
  await page.getByRole("button").filter({ hasText: "Emily Carter" }).click();
  await page.getByLabel("Lead stage").selectOption("Contacted");
  await page.getByLabel("Lead note").fill("Asked for a proposal.");
  await page.getByRole("button", { name: "Save note" }).click();
  await page.getByRole("button", { name: "Edit follow-up" }).click();
  await page
    .getByLabel("Task", { exact: true })
    .fill("Send proposal on Friday");
  await page.getByRole("button", { name: "Save follow-up" }).click();
  await page.reload();
  await page.getByRole("button").filter({ hasText: "Emily Carter" }).click();
  await expect(page.getByLabel("Lead stage")).toHaveValue("Contacted");
  await expect(page.locator(".lead-detail")).toContainText(
    "Asked for a proposal.",
  );
  await expect(page.locator(".lead-detail")).toContainText(
    "Send proposal on Friday",
  );
});
test("feedback requests return content for revision", async ({ page }) => {
  await page.goto("/approvals");
  await page.getByLabel("Add feedback").fill("Please shorten the caption.");
  await page.getByRole("button", { name: "Request changes" }).click();
  await page.getByRole("button", { name: /^Changes requested/ }).click();
  await expect(page.locator(".approval-detail")).toContainText(
    "Please shorten the caption.",
  );
});
test("asset uploads survive reload using IndexedDB", async ({ page }) => {
  await page.goto("/assets");
  await page.locator("#asset-upload").setInputFiles({
    name: "test-asset.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6n0AAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "Save assets" }).click();
  await expect(page.locator(".asset-grid")).toContainText("test-asset.png");
  await page.reload();
  await expect(page.locator(".asset-grid")).toContainText("test-asset.png");
  await page.getByRole("button").filter({ hasText: "test-asset.png" }).click();
  await expect(page.locator(".asset-detail img.asset-preview")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".asset-detail img.asset-preview")
        .evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
    )
    .toBe(true);
});
test("automation toggles and simulations are clearly local", async ({
  page,
}) => {
  await page.goto("/automations");
  await page
    .getByRole("button", { name: "Lead capture to CRM", exact: true })
    .click();
  await page.getByRole("button", { name: "Run demo" }).click();
  await expect(page.locator(".automation-detail")).toContainText(
    "No external services were called.",
  );
  await page
    .getByRole("switch", { name: "Enable Lead capture to CRM" })
    .click();
  await expect(page.getByRole("button", { name: "Run demo" })).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("switch", { name: "Enable Lead capture to CRM" }),
  ).toHaveAttribute("aria-checked", "false");
});
test("reports export actual filtered demo records", async ({ page }) => {
  await page.goto("/reports");
  await page.getByLabel("Selected client").selectOption("coastal");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export report", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("grailhiiv-report-2026-09.csv");
  await page.getByLabel("Reporting period").fill("2026-10");
  await expect(
    page.getByRole("heading", { name: "No published content in this period" }),
  ).toBeVisible();
});
test("client preferences save and a new client can be created", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByLabel("Brand voice").fill("Warm and concise.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("Brand voice")).toHaveValue("Warm and concise.");
  await page.getByRole("button", { name: "Add client", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Client name").fill("Test Studio");
  await modal.getByRole("button", { name: "Add client" }).click();
  await page
    .getByLabel("Selected client")
    .selectOption({ label: "Test Studio" });
  await page.goto("/");
  await expect(page.locator(".metric-card").first()).toContainText("01");
});
test("mobile navigation and pages have no body overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    "/",
    "/calendar",
    "/approvals",
    "/leads",
    "/automations",
    "/assets",
    "/reports",
    "/settings",
  ]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
  }
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Content calendar", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Content calendar", level: 1 }),
  ).toBeVisible();
});
test("reference typography, image sources and desktop column sizes are applied", async ({
  page,
}) => {
  await page.goto("/assets");
  await expect(page.locator(".asset-card").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page
      .locator("body")
      .evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain("Roboto");
  expect(
    await page.locator("h1").evaluate((el) => getComputedStyle(el).fontSize),
  ).toBe("33.792px");
  expect(
    await page
      .locator(".sidebar")
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBe(256);
  expect(
    await page
      .locator(".topbar")
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBe(64);
  expect(
    await page
      .locator(".asset-grid")
      .evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
      ),
  ).toBe(3);
  await expect(
    page.locator(".asset-card").first().locator("img"),
  ).toHaveAttribute("src", "/media/mockup/skincare.png");
  await expect(page.locator(".asset-detail>img")).toHaveAttribute(
    "src",
    "/media/mockup/coffee-detail.png",
  );
  await page.goto("/approvals");
  await expect(page.locator(".social-preview img")).toHaveAttribute(
    "src",
    "/media/mockup/approval-coffee.png",
  );
  expect(
    await page
      .locator(".approval-queue")
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBe(352);
});

test("cleared client logos stay cleared after saving and reloading", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.reload();
  await expect(
    page.locator(".settings-client-heading .client-mark img"),
  ).toHaveCount(0);
});

test("save visual references of the built screens", async ({ page }) => {
  for (const route of [
    "",
    "calendar",
    "approvals",
    "leads",
    "automations",
    "assets",
    "reports",
    "settings",
  ]) {
    await page.goto("/" + route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.locator("main img").evaluateAll(async (images) => {
      await Promise.all(
        images.map((img) =>
          img instanceof HTMLImageElement
            ? img.decode().catch(() => {})
            : Promise.resolve(),
        ),
      );
    });
    await page.screenshot({
      path: `design/implemented/${route || "overview"}-desktop.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `design/implemented/${route || "overview"}-viewport.png`,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.screenshot({
    path: "design/implemented/overview-mobile.png",
    fullPage: true,
  });
});
