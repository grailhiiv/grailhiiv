import { test, expect } from "@playwright/test";
import { createSeed } from "../../src/lib/data";

for (const width of [1280, 390]) {
  test(`pending plan opens directly in review with visible actions at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 });
    const data = createSeed();
    const client = data.clients[1];
    const wid = "20000000-0000-4000-8000-000000000001";
    let rejected = false;
    await page.route("**/api/workspace*", (route) =>
      route.fulfill({
        json: {
          data,
          session: {
            workspaceId: wid,
            role: "owner",
            email: "owner@example.test",
          },
          workspaces: [],
        },
      }),
    );
    await page.route("**/api/agents*", (route) => {
      if (route.request().method() === "POST") {
        expect(route.request().postDataJSON().approved).toBe(false);
        rejected = true;
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({
        json: {
          models: [{ key: "test", label: "Test Model" }],
          runs: [
            {
              id: "30000000-0000-4000-8000-000000000001",
              client_id: client.id,
              status: rejected ? "Rejected" : "Awaiting approval",
              detail: rejected ? "No content created." : "Review the plan.",
              created_at: new Date().toISOString(),
              proposal: {
                posts: Array.from({ length: 5 }, (_, i) => ({
                  title: `Long idea ${i + 1}`,
                  platform: "Instagram",
                  caption: "A thoughtful caption for the audience. ".repeat(35),
                })),
              },
            },
          ],
        },
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Draft Plan", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Review Content Plan" }),
    ).toBeVisible();
    await expect(dialog.getByText("Ready for Review")).toBeVisible();
    await expect(dialog.getByText(client.name, { exact: false })).toBeVisible();
    await expect(dialog.getByLabel("Content Brief")).toHaveCount(0);
    const create = dialog.getByRole("button", { name: "Create 5 Drafts" });
    const position = await create.boundingBox();
    expect(position!.y + position!.height).toBeLessThanOrEqual(720);
    expect(
      await page
        .locator(".agent-body")
        .evaluate((e) => e.scrollHeight > e.clientHeight),
    ).toBe(true);
    await page
      .locator(".agent-body")
      .evaluate((e) => (e.scrollTop = e.scrollHeight));
    await expect(create).toBeInViewport();
    await page.screenshot({ path: `test-results/agent-review-${width}.png` });
    await dialog.getByRole("button", { name: "Reject Proposal" }).click();
    await expect(
      dialog.getByRole("heading", { name: "Proposal Rejected" }),
    ).toBeVisible({ timeout: 10000 });
    await dialog.getByRole("button", { name: "Create Another Plan" }).click();
    await expect(dialog.getByLabel("Content Brief")).toBeVisible();
  });
}

test("AI content plans show model-generated proposals and require an explicit draft decision", async ({
  page,
}) => {
  const data = createSeed();
  const workspaceId = "20000000-0000-4000-8000-000000000001";
  const runId = "30000000-0000-4000-8000-000000000001";
  let status = "Awaiting approval";
  let generated = false;
  let accepted = false;
  await page.route("**/api/workspace*", (route) =>
    route.fulfill({
      json: {
        data,
        session: {
          email: "owner@example.test",
          userId: "10000000-0000-4000-8000-000000000001",
          workspaceId,
          role: "owner",
        },
        workspaces: [{ workspace_id: workspaceId, role: "owner" }],
      },
    }),
  );
  await page.route("**/api/agents*", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      expect(body.workspaceId).toBe(workspaceId);
      if (body.action === "generate") {
        expect(body.clientId).toBe(data.clients[0].id);
        expect(body.modelKey).toBe("test-model");
        expect(body.brief).toBe("Introduce our new seasonal menu");
        expect(body.requestId).toMatch(/^[a-f0-9-]{36}$/);
        generated = true;
        return route.fulfill({ status: 202, json: { runId } });
      }
      expect(body.action).toBe("decide");
      expect(body.runId).toBe(runId);
      accepted = body.approved;
      status = accepted ? "Completed" : "Rejected";
      if (accepted)
        data.posts.push(
          ...Array.from({ length: 5 }, (_, i) => ({
            id: `ai-${runId}-${i + 1}`,
            clientId: data.clients[0].id,
            title: `Seasonal idea ${i + 1}`,
            caption: `Fresh seasonal caption ${i + 1}`,
            platform: "Instagram",
            status: "Draft" as const,
            date: "",
            time: "09:00",
            assetId: "",
            notes: [],
          })),
        );
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({
      json: {
        models: [{ key: "test-model", label: "Configured model" }],
        runs: generated
          ? [
              {
                id: runId,
                created_at: new Date().toISOString(),
                client_id: data.clients[0].id,
                status,
                detail: accepted
                  ? "Five AI drafts created."
                  : "Review the generated captions.",
                proposal: {
                  posts: Array.from({ length: 5 }, (_, i) => ({
                    title: `Seasonal idea ${i + 1}`,
                    caption: `Fresh seasonal caption ${i + 1}`,
                    platform: "Instagram",
                  })),
                },
              },
            ]
          : [],
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Draft Plan", exact: true }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByLabel("AI Model")).toContainText("Configured model");
  await modal
    .getByLabel("Content Brief")
    .fill("Introduce our new seasonal menu");
  await modal
    .getByRole("button", { name: "Generate AI Content Plan", exact: true })
    .click();
  await expect(
    modal.getByRole("heading", {
      name: "Generating Content Plan",
      exact: true,
    }),
  ).toBeVisible();
  await expect(modal.getByLabel("Content Brief")).toHaveCount(0);
  await expect(modal.getByText("Fresh seasonal caption 5")).toBeVisible({
    timeout: 10000,
  });
  expect(accepted).toBe(false);
  await expect(
    modal.getByRole("button", {
      name: "Generate AI Content Plan",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close Dialog" }).click();
  await page.getByRole("button", { name: "Draft Plan", exact: true }).click();
  await expect(
    modal.getByRole("heading", { name: "Review Content Plan" }),
  ).toBeVisible();
  await expect(modal.getByLabel("Content Brief")).toHaveCount(0);
  await modal.getByRole("button", { name: "Create 5 Drafts" }).click();
  await expect(
    modal.getByRole("heading", { name: "Drafts Created", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  expect(accepted).toBe(true);
  await modal.getByRole("button", { name: "View Drafts" }).click();
  await expect(page).toHaveURL(/\/calendar#unscheduled-ideas$/);
  await expect(
    page.locator("#unscheduled-ideas").getByText("Seasonal idea 5"),
  ).toBeVisible();
});

test("missing AI configuration prevents generation", async ({ page }) => {
  const data = createSeed();
  await page.route("**/api/workspace*", (route) =>
    route.fulfill({
      json: {
        data,
        session: {
          email: "owner@example.test",
          workspaceId: "20000000-0000-4000-8000-000000000001",
          userId: "10000000-0000-4000-8000-000000000001",
          role: "owner",
        },
        workspaces: [],
      },
    }),
  );
  await page.route("**/api/agents*", (route) =>
    route.fulfill({ json: { models: [], runs: [] } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Draft Plan", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "No AI model configured",
  );
  await expect(
    page.getByRole("button", { name: "Generate AI Content Plan", exact: true }),
  ).toBeDisabled();
  expect(data.posts.length).toBe(createSeed().posts.length);
});

test("AI action errors survive successful polling and signed-out APIs reject calls", async ({
  page,
  request,
}) => {
  const response = await request.get(
    "/api/agents?workspaceId=20000000-0000-4000-8000-000000000001",
  );
  expect(response.status()).toBe(401);
  const forged = await request.post("/api/agents", {
    headers: { origin: "https://untrusted.example" },
    data: {},
  });
  expect(forged.status()).toBe(400);
  expect(await forged.json()).toEqual({
    error: "Request origin is not allowed.",
  });
  await page.route("**/api/workspace*", (route) =>
    route.fulfill({
      json: {
        data: createSeed(),
        session: {
          workspaceId: "20000000-0000-4000-8000-000000000001",
          role: "owner",
        },
        workspaces: [],
      },
    }),
  );
  let polls = 0;
  await page.route("**/api/agents*", (route) => {
    if (route.request().method() === "POST")
      return route.fulfill({
        status: 400,
        json: { error: "Hourly AI run limit reached." },
      });
    polls++;
    return route.fulfill({
      json: { models: [{ key: "test-model", label: "Test" }], runs: [] },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Draft Plan", exact: true }).click();
  await page
    .getByRole("button", { name: "Generate AI Content Plan", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Hourly AI run limit reached.",
  );
  const before = polls;
  await expect.poll(() => polls).toBeGreaterThan(before);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Hourly AI run limit reached.",
  );
});
