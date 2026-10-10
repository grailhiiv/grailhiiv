import { test, expect } from "@playwright/test";
import { createSeed } from "../../src/lib/data";
const session = {
  email: "owner@example.test",
  userId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000001",
  role: "owner",
};
test("cloud login, recovery and password screens show errors without workspace data", async ({
  page,
}) => {
  let booted = false;
  await page.route("**/api/workspace*", (route) => {
    booted = true;
    return route.fulfill({
      status: 401,
      json: { error: "Sign in to continue." },
    });
  });
  await page.route("**/api/auth", (route) =>
    route.fulfill({
      status: 400,
      json: { error: "Invalid login credentials" },
    }),
  );
  await page.goto("/login");
  await expect.poll(() => booted).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Sign in to your workspace" }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("invalid-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Invalid login credentials",
  );
  await expect(page.getByText("Coastal Studio", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(
    page.getByRole("heading", { name: "Recover your password" }),
  ).toBeVisible();
  await page.goto("/auth/password");
  await expect(
    page.getByRole("heading", { name: "Set your password" }),
  ).toBeVisible();
});
test("cloud writes persist through the API and failed saves stay visible", async ({
  page,
}) => {
  let data = createSeed();
  let fail = false;
  await page.route("**/api/workspace*", async (route) => {
    if (route.request().method() === "POST") {
      if (fail)
        return route.fulfill({
          status: 400,
          json: {
            error: "This record changed on another device. Reload and retry.",
          },
        });
      const body = route.request().postDataJSON();
      for (const change of body.changes) {
        const records = data[change.kind as "posts"];
        const index = records.findIndex((r) => r.id === change.id);
        if (index >= 0) records[index] = change.after;
        else records.push(change.after);
      }
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({
      json: {
        data,
        session,
        workspaces: [{ workspace_id: session.workspaceId, role: session.role }],
      },
    });
  });
  await page.goto("/calendar");
  await expect(page.locator(".cloud-controls [role=status]")).toBeVisible();
  await page
    .getByRole("button", { name: "Create content", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Post title").fill("Shared draft");
  await modal.getByLabel("Caption").fill("Saved in PostgreSQL");
  await modal.getByRole("button", { name: "Save draft" }).click();
  await expect
    .poll(() => data.posts.some((p) => p.title === "Shared draft"))
    .toBe(true);
  await page.reload();
  await expect(page.getByText("Shared draft")).toBeVisible();
  fail = true;
  await page
    .getByRole("button", { name: "Create content", exact: true })
    .click();
  await modal.getByLabel("Post title").fill("Conflict draft");
  await modal.getByRole("button", { name: "Save draft" }).click();
  await expect(page.locator(".storage-warning")).toContainText(
    "Changes were not saved",
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Conflict draft")).toHaveCount(0);
});
test("reviewer screens hide client management, lead records and upload controls", async ({
  page,
}) => {
  const data = createSeed();
  data.clients = data.clients.slice(0, 1);
  data.posts = data.posts.filter((p) => p.clientId === data.clients[0].id);
  data.assets = data.assets.filter((a) => a.clientId === data.clients[0].id);
  data.leads = [];
  data.automations = [];
  await page.route("**/api/workspace*", (route) =>
    route.fulfill({
      json: {
        data,
        session: { ...session, role: "client_reviewer" },
        workspaces: [],
      },
    }),
  );
  await page.goto("/approvals");
  await expect(
    page.getByRole("heading", { name: "Approvals", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Leads & CRM" })).toHaveCount(0);
  await page.goto("/assets");
  await expect(page.getByText("Upload assets", { exact: true })).toHaveCount(0);
  await page.goto("/leads");
  await expect(
    page.getByRole("heading", { name: "Client access" }),
  ).toBeVisible();
});
