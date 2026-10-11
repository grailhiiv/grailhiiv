import { test, expect, type Page } from "@playwright/test";
import { createSeed } from "../../src/lib/data";
import { defaultLimits } from "../../src/lib/operations";
const wid = "20000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000001";
async function fixture(page: Page, role = "owner") {
  const data = createSeed();
  data.clients[0].name = "Client_" + "LongName".repeat(10);
  data.clients[0].contact = "A contact with a long display name";
  data.clients[0].description = "A client description that should wrap cleanly in the client list.";
  const email = "long.account.address.for.settings.audit@example.test";
  await page.route("**/api/workspace*", r => r.fulfill({ json: { data, session: { workspaceId: wid, userId, role, email }, workspaces: [] } }));
  await page.route("**/api/team*", r => r.fulfill({ json: { members: [{ user_id: userId, role: "owner" }, { user_id: "10000000-0000-4000-8000-000000000002", role: "team_member" }], access: [], invitations: [{ id: "invite", email: "averylong.invitation.address@example.test", role: "team_member", expires_at: "2026-11-01T00:00:00Z" }] } }));
  await page.route("**/api/operations*", r => r.fulfill({ json: { settings: defaultLimits, usage: [], workers: [], backups: [{ id: "backup", created_at: "2026-10-11T00:00:00Z", status: "Success", detail: "Verified backup: " + "LongDetail".repeat(20) }], rules: [{ id: "rule", name: "LongRuleName".repeat(8), enabled: false }], runs: [{ id: "run", status: "Failed", attempts: 1, detail: "LongDetail".repeat(20) }], assetsBytes: 0 } }));
  await page.route("**/api/social*", r => r.fulfill({ json: { configured: false, workerAvailable: false, redirectUri: "http://127.0.0.1:3100/api/social/callback", connections: [], jobs: [], pending: [] } }));
  return data;
}
for (const width of [1440, 1024, 768, 390, 320]) {
  test(`all Settings tabs fit at ${width}px with long client and account content`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await fixture(page); await page.goto("/settings");
    await expect(page.getByRole("button", { name: "Workspace", exact: true })).toBeVisible();
    const tabBounds = await page.locator(".settings-tabs > button").evaluateAll(elements => elements.map(el => ({ text:el.textContent, left:el.getBoundingClientRect().left, right:el.getBoundingClientRect().right })));
    expect(tabBounds).toHaveLength(6);
    for (const bounds of tabBounds) { expect(bounds.left, `${bounds.text} must be visible`).toBeGreaterThanOrEqual(0); expect(bounds.right, `${bounds.text} must not be clipped`).toBeLessThanOrEqual(width); }
    for (const tab of ["Workspace", "Clients", "Team & Permissions", "Connected Accounts", "AI Preferences", "Notifications"]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      if (tab === "Team & Permissions") await expect(page.getByRole("button", { name: "Create Invitation", exact: true })).toBeVisible();
      if (tab === "Connected Accounts") await expect(page.getByRole("button", { name: "Connect Facebook", exact: true })).toBeVisible();
      if (tab === "AI Preferences") {
        await expect(page.getByRole("button", { name: "Save AI Preferences", exact: true })).toBeEnabled();
        for (const summary of ["Advanced AI and Storage Settings", "Service and Backup Status", "Automatic Workspace Actions"]) await page.getByText(summary, { exact: true }).click();
      }
      const overflow = await page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll("main *")].filter(el => { const r=el.getBoundingClientRect(); return r.width && r.right > window.innerWidth+2 && !el.closest(".settings-tabs,.client-list"); }).slice(0,8).map(el => ({ tag:el.tagName, class:el.className, text:el.textContent?.slice(0,50) })) }));
      expect(overflow.scroll, `${tab}: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(width + 1);
      expect(overflow.offenders, `${tab}: content must fit without clipping`).toEqual([]);
      if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`settings-${tab.replaceAll(/[^a-z]/gi,"-")}.png`), fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}
test("account and Settings tabs keep transparent hover backgrounds and keyboard focus", async ({ page }) => {
  await fixture(page); await page.goto("/settings");
  const tab = page.getByRole("button", { name: "Workspace", exact: true });
  await tab.hover();
  await expect.poll(() => tab.evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  const account = page.getByLabel("Account Menu", { exact: true });
  await account.hover(); await expect.poll(() => account.evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  await tab.focus(); await tab.press("Tab");
  const next = page.getByRole("button", { name: "Clients", exact: true });
  await expect(next).toBeFocused();
  expect(await next.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
  const addClient = page.getByRole("button", { name: "Add Client", exact: true });
  await addClient.hover(); await expect.poll(() => addClient.evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  await expect(page.getByText("Shared workspace", { exact: true })).toHaveCount(0);
  await expect(page.locator(".app-footer")).toHaveCount(0);
});
test("team members can view client preferences but cannot edit owner settings", async ({ page }) => {
  await fixture(page,"team_member"); await page.goto("/settings");
  await expect(page.getByRole("textbox", { name: "Client Name", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save Changes", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Workspace Name", exact: true })).toBeDisabled();
});
