import { test, expect } from "@playwright/test";
import { createSeed } from "../../src/lib/data";
import type { AutomationConnection } from "../../src/lib/n8n-types";

const session = {
  email: "owner@example.test",
  userId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000001",
  role: "owner",
};
test("owner connects a workflow and sees queued/completed API results after reload", async ({
  page,
}) => {
  const data = createSeed();
  data.automations = [
    {
      id: "a",
      name: "Verify connection",
      clientId: data.clients[0].id,
      trigger: "Manual",
      enabled: true,
      runs: [],
    },
  ];
  const connection: AutomationConnection = {
    configured: true,
    reachable: true,
    workflows: [
      { key: "connection-check", label: "Verify automation connection" },
    ],
    bindings: [],
    runs: [],
  };
  await page.route("**/api/workspace*", (route) =>
    route.fulfill({ json: { data, session, workspaces: [] } }),
  );
  await page.route("**/api/automations*", (route) => {
    if (route.request().method() !== "POST")
      return route.fulfill({ json: connection });
    const input = route.request().postDataJSON();
    expect(input.workspaceId).toBe(session.workspaceId);
    expect(input.automationId).toBe("a");
    expect(input.url).toBeUndefined();
    if (input.action === "bind") {
      connection.bindings = [
        { automation_id: "a", workflow_key: input.workflowKey },
      ];
      return route.fulfill({ json: { ok: true } });
    }
    connection.runs = [
      {
        id: input.requestId,
        automation_id: "a",
        status: "Queued",
        detail: "Waiting for the automation worker.",
        created_at: new Date().toISOString(),
        started_at: null,
        finished_at: null,
        execution_id: null,
      },
    ];
    return route.fulfill({ status: 202, json: { runId: input.requestId } });
  });
  await page.goto("/automations");
  const run = page.getByRole("button", {
    name: "Run Verify connection",
    exact: true,
  });
  await expect(run).toBeDisabled();
  await page
    .getByLabel("Workflow for Verify connection")
    .selectOption("connection-check");
  await expect(run).toBeEnabled();
  await run.click();
  await expect(run).toBeDisabled();
  await expect(
    page.getByText("Waiting for the automation worker."),
  ).toBeVisible();
  connection.runs[0] = {
    ...connection.runs[0],
    status: "Success",
    detail: "n8n connection verified. No external actions were performed.",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    execution_id: "42",
  };
  await page.reload();
  await expect(page.getByText("Execution 42")).toBeVisible();
  await expect(
    page.getByText(
      "n8n connection verified. No external actions were performed.",
    ),
  ).toBeVisible();
  await expect(run).toBeEnabled();
  await page.screenshot({
    path: "test-results/n8n-automations.png",
    fullPage: true,
  });
});
test("team member cannot change connections and unknown outcomes explain duplicate-action risk", async ({
  page,
}) => {
  const data = createSeed();
  data.automations = [
    {
      id: "a",
      name: "Client follow-up",
      clientId: data.clients[0].id,
      trigger: "Manual",
      enabled: true,
      runs: [],
    },
  ];
  await page.route("**/api/workspace*", (route) =>
    route.fulfill({
      json: {
        data,
        session: { ...session, role: "team_member" },
        workspaces: [],
      },
    }),
  );
  await page.route("**/api/automations*", (route) =>
    route.fulfill({
      json: {
        configured: true,
        reachable: true,
        workflows: [{ key: "follow-up", label: "Follow-up workflow" }],
        bindings: [{ automation_id: "a", workflow_key: "follow-up" }],
        runs: [
          {
            id: crypto.randomUUID(),
            automation_id: "a",
            status: "Unknown",
            detail: "Delivery could not be confirmed.",
            created_at: new Date().toISOString(),
            started_at: null,
            finished_at: null,
            execution_id: null,
          },
        ],
      },
    }),
  );
  await page.goto("/automations");
  await expect(page.getByLabel("Workflow for Client follow-up")).toHaveCount(0);
  await expect(
    page.getByText("The action may have executed.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run Client follow-up" }),
  ).toBeEnabled();
});
test("unconfigured n8n cannot execute a workflow", async ({ page }) => {
  const data = createSeed();
  data.automations = [
    {
      id: "a",
      name: "Not configured",
      clientId: data.clients[0].id,
      trigger: "Manual",
      enabled: true,
      runs: [],
    },
  ];
  await page.route("**/api/workspace*", (route) =>
    route.fulfill({ json: { data, session, workspaces: [] } }),
  );
  await page.route("**/api/automations*", (route) =>
    route.fulfill({
      json: {
        configured: false,
        reachable: false,
        workflows: [],
        bindings: [],
        runs: [],
      },
    }),
  );
  await page.goto("/automations");
  await expect(
    page.getByText(
      "Ask your administrator to configure the automation service.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run Not configured" }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(
    page.getByText(
      "Ask your administrator to configure the automation service.",
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const actionBounds = await page
    .getByRole("button", { name: "Run Not configured" })
    .boundingBox();
  expect(actionBounds!.x).toBeGreaterThanOrEqual(0);
  expect(actionBounds!.x + actionBounds!.width).toBeLessThanOrEqual(375);
});
test("automation APIs reject signed-out callers, forged origins and invalid callback credentials", async ({
  request,
}) => {
  const workspaceId = session.workspaceId;
  const read = await request.get(`/api/automations?workspaceId=${workspaceId}`);
  expect(read.status()).toBe(401);
  const write = await request.post("/api/automations", {
    headers: { origin: "https://untrusted.example" },
    data: {
      action: "run",
      workspaceId,
      automationId: "a",
      requestId: crypto.randomUUID(),
    },
  });
  expect(write.status()).toBe(400);
  expect((await write.json()).error).toBe("Request origin is not allowed.");
  const callback = await request.post(
    `/api/automations/callback/${crypto.randomUUID()}`,
    {
      headers: { authorization: "Bearer forged" },
      data: { status: "Success", detail: "Forged", executionId: "1" },
    },
  );
  expect(callback.status()).toBe(401);
});

test("retired workflow bindings cannot run and search explains an empty result", async ({
  page,
}) => {
  const data = createSeed();
  data.automations = [
    {
      id: "a",
      name: "Retired workflow",
      clientId: data.clients[0].id,
      trigger: "Manual",
      enabled: true,
      runs: [],
    },
  ];
  await page.route("**/api/workspace*", (route) =>
    route.fulfill({ json: { data, session, workspaces: [] } }),
  );
  await page.route("**/api/automations*", (route) =>
    route.fulfill({
      json: {
        configured: true,
        reachable: true,
        workflows: [{ key: "new", label: "Current workflow" }],
        bindings: [{ automation_id: "a", workflow_key: "retired" }],
        runs: [],
      },
    }),
  );
  await page.goto("/automations");
  await expect(
    page.getByRole("button", { name: "Run Retired workflow", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Choose an available workflow.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search Automations").fill("No matching workflow");
  await expect(
    page.getByText("No automations match your search.", { exact: true }),
  ).toBeVisible();
});

test("long execution details remain readable without page overflow on mobile", async ({
  page,
}) => {
  const data = createSeed();
  data.automations = [
    {
      id: "a",
      name: "Long automation name ".repeat(4),
      clientId: data.clients[0].id,
      trigger: "Manual",
      enabled: false,
      runs: [],
    },
  ];
  const detail = "Detailed result ".repeat(60) + "x".repeat(100);
  await page.route("**/api/workspace*", (route) =>
    route.fulfill({ json: { data, session, workspaces: [] } }),
  );
  await page.route("**/api/automations*", (route) =>
    route.fulfill({
      json: {
        configured: true,
        reachable: true,
        workflows: [],
        bindings: [],
        runs: [
          {
            id: crypto.randomUUID(),
            automation_id: "a",
            status: "Failed",
            detail,
            created_at: new Date().toISOString(),
            started_at: null,
            finished_at: null,
            execution_id: "long-detail-check",
          },
        ],
      },
    }),
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/automations");
  const cell = page.getByRole("cell", { name: detail, exact: true });
  await expect(cell).toBeVisible();
  expect(
    await cell.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 2,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByLabel("Automation Summary").locator(".metric-card"),
  ).toHaveCount(3);
  await page.screenshot({
    path: "test-results/automations-long-details-mobile.png",
    fullPage: true,
  });
});

test("workflow errors stay visible through healthy polling without claiming n8n is down", async ({
  page,
}) => {
  const data = createSeed();
  data.automations = [
    {
      id: "a",
      name: "Connection error",
      clientId: data.clients[0].id,
      trigger: "Manual",
      enabled: true,
      runs: [],
    },
  ];
  let reads = 0;
  await page.route("**/api/workspace*", (route) =>
    route.fulfill({ json: { data, session, workspaces: [] } }),
  );
  await page.route("**/api/automations*", (route) => {
    if (route.request().method() === "POST")
      return route.fulfill({
        status: 400,
        json: {
          error: "Wait for the active run before changing its workflow.",
        },
      });
    reads++;
    return route.fulfill({
      json: {
        configured: true,
        reachable: true,
        workflows: [{ key: "check", label: "Check connection" }],
        bindings: [],
        runs: [],
      },
    });
  });
  await page.goto("/automations");
  await page.getByLabel("Workflow for Connection error").selectOption("check");
  await expect(page.locator("p.storage-warning[role=alert]")).toContainText(
    "Wait for the active run",
  );
  await expect(
    page.getByText("n8n is reachable. Connected workflows can run manually.", {
      exact: true,
    }),
  ).toBeVisible();
  const before = reads;
  await expect.poll(() => reads, { timeout: 10000 }).toBeGreaterThan(before);
  await expect(page.locator("p.storage-warning[role=alert]")).toContainText(
    "Wait for the active run",
  );
});
