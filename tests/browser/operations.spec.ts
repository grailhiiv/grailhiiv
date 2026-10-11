import { test, expect } from "@playwright/test";
import { createSeed } from "../../src/lib/data";
import { defaultLimits } from "../../src/lib/operations";
const wid = "20000000-0000-4000-8000-000000000001";
test("saving the simple budget preserves advanced settings and distinguishes a failed refresh from a failed save", async ({page}) => {
  const settings = {...defaultLimits, hourly_ai_calls:45, daily_ai_tokens:250000, daily_ai_budget:0.001, asset_quota_bytes:1073741825, checkpoint_days:90, reasoning_effort:"high"};
  let saved:any = null;
  await page.route("**/api/workspace*", r=>r.fulfill({json:{data:createSeed(),session:{workspaceId:wid,role:"owner",email:"owner@example.test"},workspaces:[]}}));
  await page.route("**/api/operations*",r=>{
    if(r.request().method()==="POST") {saved=r.request().postDataJSON().settings;return r.fulfill({json:{ok:true}});}
    if(saved) return r.fulfill({status:503,json:{error:"Status temporarily unavailable"}});
    return r.fulfill({json:{settings,usage:[],workers:[],backups:[],rules:[],runs:[],assetsBytes:0}});
  });
  await page.goto("/settings"); await page.getByRole("button",{name:"AI Preferences",exact:true}).click();
  await expect(page.getByRole("button",{name:"Save AI Preferences",exact:true})).toBeEnabled();
  await expect(page.getByLabel("AI Reasoning Level")).not.toBeVisible();
  await page.getByLabel("Daily Spending Limit (USD)").fill("2.50");
  await page.getByRole("button",{name:"Save AI Preferences",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("AI preferences saved.");
  expect(saved).toEqual({...settings,daily_ai_budget:2.5});
  await expect(page.locator(".operations-settings").getByRole("alert")).toContainText("Your changes were saved");
});
test("invalid controls in a closed advanced section are revealed instead of silently blocking save",async({page})=>{
  let writes=0;
  await page.route("**/api/workspace*",r=>r.fulfill({json:{data:createSeed(),session:{workspaceId:wid,role:"owner",email:"owner@example.test"},workspaces:[]}}));
  await page.route("**/api/operations*",r=>{if(r.request().method()==="POST")writes++;return r.fulfill({json:{settings:defaultLimits,usage:[],workers:[],backups:[],rules:[],runs:[],assetsBytes:0}});});
  await page.goto("/settings"); await page.getByRole("button",{name:"AI Preferences",exact:true}).click();
  await expect(page.getByRole("button",{name:"Save AI Preferences",exact:true})).toBeEnabled();
  await page.getByText("Advanced AI and Storage Settings",{exact:true}).click();
  await page.getByLabel("AI Requests per Hour").fill("0");
  await page.getByText("Advanced AI and Storage Settings",{exact:true}).click();
  await page.getByRole("button",{name:"Save AI Preferences",exact:true}).click();
  await expect(page.getByLabel("AI Requests per Hour")).toBeVisible();
  await expect(page.getByLabel("AI Requests per Hour")).toBeFocused(); expect(writes).toBe(0);
});
test("owners can save limits and internal rules and see worker/backup status", async ({
  page,
}) => {
  const data = createSeed();
  let settings = { ...defaultLimits };
  let rules: any[] = [];
  await page.route("**/api/workspace*", (r) =>
    r.fulfill({
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
  await page.route("**/api/operations*", (r) => {
    if (r.request().method() === "POST") {
      const b = r.request().postDataJSON();
      expect(b.workspaceId).toBe(wid);
      if (b.action === "limits") settings = b.settings;
      else if (b.action === "rule")
        rules = [{ ...b.rule, id: "30000000-0000-4000-8000-000000000001" }];
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({
      json: {
        settings,
        usage: [],
        rules,
        runs: [],
        assetsBytes: 1024,
        workers: [
          {
            name: "ai",
            available: true,
            healthy: true,
            last_seen: new Date().toISOString(),
            error_code: "",
          },
        ],
        backups: [
          {
            id: "test",
            status: "Success",
            detail: "Encrypted snapshot verified.",
            created_at: new Date().toISOString(),
          },
        ],
      },
    });
  });
  await page.goto("/settings");
  await page
    .getByRole("button", { name: "AI Preferences", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "AI Preferences", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Daily Text Allowance (Tokens)")).not.toBeVisible();
  await page.getByText("Advanced AI and Storage Settings", { exact: true }).click();
  await page.getByLabel("Daily Text Allowance (Tokens)").fill("50000");
  await page.getByLabel("AI Reasoning Level").selectOption("low");
  await page.getByRole("button", { name: "Save AI Preferences" }).click();
  await expect(page.getByRole("status")).toContainText(
    "AI preferences saved.",
  );
  expect(settings.daily_ai_tokens).toBe(50000);
  expect(settings.reasoning_effort).toBe("low");
  await page.getByText("Automatic Workspace Actions", { exact: true }).click();
  await page.getByLabel("Action Name").fill("New lead follow-up");
  await page.getByLabel("Turn On This Action").check();
  await page.getByRole("button", { name: "Save Action" }).click();
  await expect(page.getByText("New lead follow-up · On")).toBeVisible();
  await page.getByText("Service and Backup Status", { exact: true }).click();
  await expect(
    page.getByText("Encrypted snapshot verified.", { exact: false }),
  ).toBeVisible();
});
test("editing and regenerating a proposal preserves dates, assets and other captions", async ({
  page,
}) => {
  const data = createSeed();
  const client = data.clients[0],
    asset = data.assets.find((a) => a.clientId === client.id)!;
  let proposal = {
    posts: Array.from({ length: 5 }, (_, i) => ({
      title: `Idea ${i + 1}`,
      caption: `Caption ${i + 1}`,
      platform: "Instagram",
    })),
  } as any;
  await page.route("**/api/workspace*", (r) =>
    r.fulfill({
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
  await page.route("**/api/agents*", (r) => {
    if (r.request().method() === "POST") {
      const b = r.request().postDataJSON();
      expect(b.expectedProposal).toEqual(proposal);
      if (b.action === "edit") proposal = b.proposal;
      else if (b.action === "regenerate") {
        expect(b.index).toBe(0);
        proposal = {
          posts: proposal.posts.map((p: any, i: number) =>
            i === 0 ? { ...p, caption: "Regenerated first caption" } : p,
          ),
        };
      }
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({
      json: {
        models: [{ key: "test", label: "Test" }],
        runs: [
          {
            id: "30000000-0000-4000-8000-000000000001",
            client_id: client.id,
            status: "Awaiting approval",
            detail: "Review",
            proposal,
            created_at: new Date().toISOString(),
          },
        ],
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Draft Plan", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Edit Plan, Dates and Assets" })
    .click();
  await dialog.getByLabel("Post 1 Title").fill("Edited idea");
  await dialog.getByLabel("Post 1 Date").fill("2026-11-01");
  await dialog.getByLabel("Post 1 Asset").selectOption(asset.id);
  await expect(
    dialog.getByRole("button", { name: "Create 5 Drafts" }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Save Plan Changes" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Edited idea" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Regenerate Post 1", exact: true })
    .click();
  await expect(
    dialog.getByText("Regenerated first caption", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect(dialog.getByText("Caption 2", { exact: true })).toBeVisible();
  expect(proposal.posts[0].date).toBe("2026-11-01");
  expect(proposal.posts[0].assetId).toBe(asset.id);
});
