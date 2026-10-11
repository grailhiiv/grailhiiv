import { test, expect } from "@playwright/test";
import { createSeed } from "../../src/lib/data";
const wid = "20000000-0000-4000-8000-000000000001", connectionId = "30000000-0000-4000-8000-000000000001";
async function workspace(page: any, role = "owner") {
  const data = createSeed();
  await page.route("**/api/workspace*", (r: any) => r.fulfill({ json: { data, session: { workspaceId: wid, role, email: "owner@example.test" }, workspaces: [] } }));
  return data;
}
test("connection buttons are active and explain missing Meta app setup", async ({ page }, testInfo) => {
  await workspace(page);
  await page.route("**/api/social*", r => r.fulfill({ json: { configured: false, workerAvailable: false, redirectUri: "http://127.0.0.1:3100/api/social/callback", connections: [], jobs: [], pending: [] } }));
  await page.goto("/settings"); await page.getByRole("button", { name: "Connected Accounts", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect Instagram", exact: true })).toBeEnabled();
  await expect(page.getByText("Worker Offline", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Setup Required", { exact: true })).toHaveCount(0);
  expect((await page.getByRole("button", { name: "Connect Instagram", exact: true }).boundingBox())!.height).toBeLessThanOrEqual(42);
  await page.screenshot({ path: testInfo.outputPath("social-settings-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Connect Instagram", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Set Up Meta Connection" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("http://127.0.0.1:3100/api/social/callback", { exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("social-settings-mobile.png"), fullPage: true });
  await page.getByRole("link", { name: "Manage Automations" }).click(); await expect(page).toHaveURL(/\/automations$/);
});
test("Facebook Connect starts authorization and Instagram selection persists after callback", async ({ page }) => {
  const data = await workspace(page);
  let selected: any = null;
  await page.route("**/api/social*", r => {
    if (r.request().method() === "POST") { selected = r.request().postDataJSON(); return r.fulfill({ json: selected.action === "connect" ? { url: "/settings?social=choose&platform=Instagram" } : { ok: true } }); }
    return r.fulfill({ json: { configured: true, workerAvailable: true, redirectUri: "http://127.0.0.1:3100/api/social/callback", connections: [], jobs: [], pending: [{ id: "123", name: "Authorized Page", instagram: true }] } });
  });
  await page.goto("/settings"); await page.getByRole("button", { name: "Connected Accounts", exact: true }).click();
  await page.getByRole("combobox", { name: "Connect Accounts For", exact: true }).selectOption(data.clients[1].id);
  await page.getByRole("button", { name: "Connect Instagram", exact: true }).click();
  await expect(page).toHaveURL(/social=choose/); expect(selected.action).toBe("connect"); expect(selected.platform).toBe("Instagram"); expect(selected.workspaceId).toBe(wid); expect(selected.clientId).toBe(data.clients[1].id);
  await page.getByRole("combobox", { name: "Facebook Page", exact: true }).selectOption("123"); await expect(page.getByRole("combobox", { name: "Publishing Platform", exact: true })).toHaveValue("Instagram");
  await page.getByRole("button", { name: "Save Account", exact: true }).click(); await expect.poll(() => selected.action).toBe("choose"); expect(selected.pageId).toBe("123"); expect(selected.platform).toBe("Instagram");
});
test("enabling scheduled sends requires explicit review and uncertain deliveries cannot one-click retry", async ({ page }) => {
  const data = await workspace(page); const actions: any[] = []; let enabled = false;
  await page.route("**/api/social*", r => {
    if (r.request().method() === "POST") { const b = r.request().postDataJSON(); actions.push(b); if (b.action === "account") enabled = true; return r.fulfill({ json: { ok: true } }); }
    return r.fulfill({ json: { configured: true, workerAvailable: true, redirectUri: "http://127.0.0.1:3100/api/social/callback", connections: [{ id: connectionId, client_id: data.clients[0].id, platform: "Facebook", account_name: "Page", account_id: "123", enabled }], pending: [], jobs: [{ id: connectionId, client_id: data.clients[0].id, post_id: "p1", snapshot: { title: "Approved Post", platform: "Facebook" }, state: "Needs review", detail: "delivery_unknown", provider_id: null, due_at: new Date().toISOString() }] } });
  });
  await page.goto("/settings"); await page.getByRole("button", { name: "Connected Accounts", exact: true }).click();
  await page.getByRole("button", { name: "Enable Publishing", exact: true }).click(); expect(actions).toHaveLength(0);
  await page.getByRole("dialog").getByRole("button", { name: "Enable Scheduled Publishing", exact: true }).click(); await expect.poll(() => actions.length).toBe(1); expect(actions[0].operation).toBe("enable");
  await page.getByRole("button", { name: "Review Uncertain Delivery", exact: true }).click(); await expect(page.getByLabel("Existing Platform Post ID")).toBeVisible();
  expect(actions).toHaveLength(1); await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 }); await expect(page.getByRole("heading", { name: "Connected Accounts", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test("non-owners see owner guidance without connection actions", async ({ page }) => {
  await workspace(page, "team_member"); await page.goto("/settings"); await page.getByRole("button", { name: "Connected Accounts", exact: true }).click();
  await expect(page.getByText(/An owner can connect Facebook/)).toBeVisible(); await expect(page.getByRole("button", { name: "Connect Facebook", exact: true })).toHaveCount(0);
});
