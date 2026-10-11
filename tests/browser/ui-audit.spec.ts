import { test, expect } from "@playwright/test";

test("desktop calendar shows all seven days without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/calendar");
  const grid = page.locator(".calendar-grid");
  await expect(grid).toBeVisible();
  expect(await page.locator(".calendar-panel").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("calendar today and week navigation follow the selected date", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-18T12:00:00"));
  await page.goto("/calendar");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.locator(".calendar-cell.today .day-number")).toHaveText("18");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.locator(".calendar-cell .day-number")).toHaveText(["16", "17", "18", "19", "20", "21", "22"]);
  await page.getByRole("button", { name: "Next Week", exact: true }).click();
  await expect(page.locator(".calendar-cell .day-number")).toHaveText(["23", "24", "25", "26", "27", "28", "29"]);
});

test("mobile leads open details only after selection and restore the selected card focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/leads");
  await expect(page.locator(".lead-detail")).toHaveCount(0);
  const card = page.locator(".lead-card").filter({ hasText: "Emily Carter" });
  await card.click();
  await expect(page.getByRole("dialog")).toContainText("Emily Carter");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card).toBeFocused();
});

test("mobile assets retain folders and show selected details in a dialog", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/assets");
  await expect(page.getByRole("button", { name: "Brand Kits", exact: true })).toBeVisible();
  await page.locator(".asset-card").filter({ hasText: "coastal-coffee.jpg" }).click();
  await expect(page.getByRole("dialog")).toContainText("coastal-coffee.jpg");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("approval metadata follows the selected client and caption", async ({ page }) => {
  await page.goto("/approvals");
  await page.locator(".approval-item").filter({ hasText: "Healthy smiles" }).click();
  await expect(page.locator(".review-content")).not.toContainText("#coastalstudio");
});

test("report chart labels follow the selected reporting month", async ({ page }) => {
  await page.goto("/reports");
  await page.getByLabel("Reporting Period").fill("2026-10");
  // No October metrics in the seed: move a sample published post into that month.
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem("grailhiiv.workspace.v1")!);
    data.posts.find((p: { status: string }) => p.status === "Published").date = "2026-10-31";
    localStorage.setItem("grailhiiv.workspace.v1", JSON.stringify(data));
  });
  await page.reload();
  await page.getByLabel("Reporting Period").fill("2026-10");
  await expect(page.locator(".reach-chart")).toContainText("Oct 22–31");
  await expect(page.locator(".reach-chart")).not.toContainText("Sep");
});

for (const width of [390, 1440]) {
  test(`secondary tabs and settings panels work at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/calendar");
    for (const view of ["Week", "List", "Month"]) {
      const button = page.getByRole("button", { name: view, exact: true });
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
    }
    await page.goto("/approvals");
    for (const view of ["Approved", "Changes Requested", "Pending"]) {
      const button = page.locator(".segmented button").filter({ hasText: new RegExp(`^${view}`) });
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
    }
    await page.goto("/leads");
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(page.locator("table")).toBeVisible();
    await page.getByLabel("Search Leads").fill("no-match-for-audit");
    await expect(page.getByRole("heading", { name: "No Matching Leads" })).toBeVisible();
    await page.goto("/assets");
    for (const folder of ["Brand Kits", "Campaigns", "Approved Assets", "Archived", "All Assets"]) {
      const button = page.getByRole("button", { name: folder, exact: true });
      await button.click();
      await expect(button).toHaveClass(/selected/);
    }
    for (const view of ["List", "Grid"]) {
      const button = page.getByRole("button", { name: view, exact: true });
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
    }
    await page.goto("/settings");
    for (const [tab, heading] of [
      ["Workspace", "Workspace Preferences"], ["Clients", "Coastal Studio"],
      ["Team & Permissions", "Team Access"], ["Connected Accounts", "Connected Accounts"],
      ["AI Preferences", "AI Provider Setup"], ["Notifications", "Workspace Notifications"],
    ]) {
      const button = page.getByRole("button", { name: tab, exact: true });
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), tab).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}

test("mobile navigation traps focus and Escape returns to its trigger", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Open Navigation" });
  await trigger.click();
  await expect(page.getByRole("button", { name: "Close Navigation" }).first()).toBeFocused();
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press("Tab");
    expect(await page.locator(".sidebar").evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Main Navigation" })).toBeHidden();
});

test("closing a nested follow-up dialog preserves the lead details", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/leads");
  await page.locator(".lead-card").filter({ hasText: "Emily Carter" }).click();
  await page.getByRole("button", { name: "Edit Follow-Up" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("dialog")).toContainText("Emily Carter");
});

test("lead details do not cover the Add lead button on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/leads");
  await page.locator(".lead-card").first().click();
  const add = page.getByRole("button", { name: "Add Lead", exact: true });
  await add.hover();
  await add.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByLabel("Full Name", { exact: true })).toBeVisible();
});

test("disabled buttons retain their appearance on hover", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/leads");
  await page.locator(".lead-card").first().click();
  const save = page.getByRole("button", { name: "Save Note", exact: true });
  await expect(save).toBeDisabled();
  await save.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  const appearance = () => save.evaluate(el => {
    const s = getComputedStyle(el);
    return [s.backgroundColor, s.backgroundImage, s.color, s.borderColor, s.boxShadow, s.transform];
  });
  const resting = await appearance();
  await save.hover();
  await expect.poll(appearance).toEqual(resting);
  await expect(save).toBeDisabled();
});

test("primary hover transitions never flash through a transparent background", async ({ page }) => {
  await page.goto("/calendar");
  const create = page.getByRole("button", { name: "Create Content", exact: true });
  await create.waitFor();
  await create.evaluate(button => {
    const frames: string[][] = [];
    const record = { running: true, frames };
    (window as unknown as { hoverRecord: typeof record }).hoverRecord = record;
    function sample() {
      const style = getComputedStyle(button);
      frames.push([style.backgroundColor, style.color]);
      if (record.running) requestAnimationFrame(sample);
    }
    sample();
  });
  for (let i = 0; i < 3; i++) {
    await create.hover();
    await page.waitForTimeout(180);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(180);
  }
  const frames = await page.evaluate(() => {
    const record = (window as unknown as { hoverRecord: { running: boolean; frames: string[][] } }).hoverRecord;
    record.running = false;
    return record.frames;
  });
  expect(frames.length).toBeGreaterThan(10);
  for (const [background, color] of frames) {
    expect(background).toMatch(/^rgb\(/);
    expect(background).not.toBe("rgb(255, 255, 255)");
    expect(color).toBe("rgb(255, 255, 255)");
  }
});
