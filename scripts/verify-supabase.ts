// Runs against the configured project with isolated, generated fixtures; sends no emails.
// Never prints credentials, cookies, or signed URLs. Removes only its own fixtures.
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createSeed } from "../src/lib/data";
import { chromium, expect } from "@playwright/test";
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !secret)
    throw new Error(
      "Configure Supabase URL, publishable key, and server-only service-role key.",
    );
  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const origin = process.env.GRAILHIIV_SITE_URL || "http://127.0.0.1:3100";
  const run = randomUUID();
  const users: {
    id: string;
    email: string;
    password: string;
    cookie: string;
  }[] = [];
  let wid = "",
    path = "",
    importWid = "";
  async function api(route: string, cookie = "", body?: unknown) {
    const response = await fetch(origin + route, {
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined
        ? { method: "POST", body: JSON.stringify(body) }
        : {}),
    });
    const data = await response.json();
    return { response, data };
  }
  async function ok(route: string, cookie: string, body?: unknown) {
    const result = await api(route, cookie, body);
    assert.ok(result.response.ok, result.data.error);
    return result;
  }
  try {
    for (let i = 0; i < 4; i++) {
      const email = `grailhiiv-smoke-${run}-${i}@example.invalid`,
        password = randomBytes(24).toString("base64url");
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw new Error(error.message);
      const user = { id: data.user.id, email, password, cookie: "" };
      users.push(user);
      const login = await ok("/api/auth", "", {
        action: "login",
        email,
        password,
      });
      user.cookie = login.response.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      assert.ok(user.cookie);
    }
    console.log(
      "PASS: four independent Supabase users signed in with server cookies",
    );
    const [owner, team, reviewer, outsider] = users;
    wid = (
      await ok("/api/team", owner.cookie, {
        action: "create",
        name: "GrailHiiv smoke " + run,
      })
    ).data.workspaceId;
    const seed = createSeed();
    const clientA = { ...seed.clients[0], id: "smoke-a" },
      clientB = { ...seed.clients[1], id: "smoke-b" };
    const draft = {
      ...seed.posts[0],
      id: "smoke-post",
      clientId: clientA.id,
      assetId: "",
      status: "Draft",
      date: "2026-10-20",
      time: "09:00",
      notes: [],
    };
    const lead = {
      ...seed.leads[0],
      id: "smoke-lead",
      clientId: clientA.id,
      task: "Follow up",
    };
    await ok("/api/workspace", owner.cookie, {
      workspaceId: wid,
      changes: [
        { kind: "clients", id: clientA.id, before: null, after: clientA },
        { kind: "clients", id: clientB.id, before: null, after: clientB },
        { kind: "posts", id: draft.id, before: null, after: draft },
        { kind: "leads", id: lead.id, before: null, after: lead },
      ],
    });
    for (const [user, role] of [
      [team, "team_member"],
      [reviewer, "client_reviewer"],
    ] as const) {
      await ok("/api/team", owner.cookie, {
        action: "invite",
        workspaceId: wid,
        email: user.email,
        role,
        clientIds: [clientA.id],
        sendEmail: false,
      });
    }
    const shared = (await ok("/api/workspace?workspaceId=" + wid, team.cookie))
      .data;
    assert.equal(shared.session.role, "team_member");
    assert.deepEqual(
      shared.data.clients.map((c: { id: string }) => c.id),
      [clientA.id],
    );
    assert.equal(shared.data.posts[0].title, draft.title);
    const reviewed = (
      await ok("/api/workspace?workspaceId=" + wid, reviewer.cookie)
    ).data;
    assert.equal(reviewed.session.role, "client_reviewer");
    assert.equal(reviewed.data.leads.length, 0);
    assert.equal(reviewed.data.clients.length, 1);
    console.log(
      "PASS: users share assigned records; reviewers cannot read leads or the second client",
    );
    const outsiderView = (
      await ok("/api/workspace?workspaceId=" + wid, outsider.cookie)
    ).data;
    assert.equal(outsiderView.session, null);
    const denied = await api("/api/workspace", outsider.cookie, {
      workspaceId: wid,
      changes: [
        {
          kind: "posts",
          id: draft.id,
          before: draft,
          after: { ...draft, title: "Tampered" },
        },
      ],
    });
    assert.equal(denied.response.ok, false);
    const scopedDenied = await api("/api/workspace", team.cookie, {
      workspaceId: wid,
      changes: [
        {
          kind: "clients",
          id: clientB.id,
          before: clientB,
          after: { ...clientB, name: "Unauthorized" },
        },
      ],
    });
    assert.equal(scopedDenied.response.ok, false);
    console.log("PASS: cross-client and cross-workspace mutations are denied");
    importWid = (
      await ok("/api/team", owner.cookie, {
        action: "create",
        name: "GrailHiiv import smoke " + run,
      })
    ).data.workspaceId;
    const imported = await ok("/api/import", owner.cookie, {
      workspaceId: importWid,
      data: createSeed(),
    });
    assert.ok(imported.data.imported > 0);
    const importedView = (
      await ok("/api/workspace?workspaceId=" + importWid, owner.cookie)
    ).data.data;
    assert.equal(importedView.clients.length, seed.clients.length);
    assert.ok(
      importedView.posts.every((p: { status: string }) => p.status === "Draft"),
    );
    assert.equal(
      (
        await api("/api/import", owner.cookie, {
          workspaceId: importWid,
          data: createSeed(),
        })
      ).response.ok,
      false,
    );
    console.log(
      "PASS: demo import saves drafts and refuses to overwrite an occupied workspace",
    );
    const submitted = { ...draft, status: "Awaiting approval" };
    await ok("/api/workspace", team.cookie, {
      workspaceId: wid,
      changes: [
        { kind: "posts", id: draft.id, before: draft, after: submitted },
      ],
    });
    const approved = { ...submitted, status: "Scheduled" };
    await ok("/api/workspace", reviewer.cookie, {
      workspaceId: wid,
      changes: [
        { kind: "posts", id: draft.id, before: submitted, after: approved },
      ],
    });
    assert.equal(
      (await ok("/api/workspace?workspaceId=" + wid, owner.cookie)).data.data
        .posts[0].status,
      "Scheduled",
    );
    const stale = await api("/api/workspace", team.cookie, {
      workspaceId: wid,
      changes: [
        {
          kind: "posts",
          id: draft.id,
          before: draft,
          after: { ...draft, caption: "Stale overwrite" },
        },
      ],
    });
    assert.equal(stale.response.ok, false);
    console.log(
      "PASS: reviewer approval persists across users; stale writes are rejected",
    );
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2Z1cAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const form = new FormData();
    form.set("workspaceId", wid);
    form.set("clientId", clientA.id);
    form.set("file", new Blob([png], { type: "image/png" }), "smoke.png");
    const upload = await fetch(origin + "/api/assets", {
      method: "POST",
      headers: { Origin: origin, Cookie: team.cookie },
      body: form,
    });
    const uploadData = await upload.json();
    assert.ok(upload.ok, uploadData.error);
    path = uploadData.asset.storagePath;
    const download = await fetch(origin + uploadData.asset.url, {
      headers: { Cookie: reviewer.cookie },
      redirect: "manual",
    });
    assert.equal(download.status, 302);
    const bytes = await fetch(download.headers.get("location")!);
    assert.equal(bytes.status, 200);
    assert.equal((await bytes.arrayBuffer()).byteLength, png.length);
    const hidden = await fetch(origin + uploadData.asset.url, {
      headers: { Cookie: outsider.cookie },
      redirect: "manual",
    });
    assert.notEqual(hidden.status, 302);
    console.log(
      "PASS: private upload, reviewer download, and outsider denial against Supabase Storage",
    );
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      await context.addCookies(
        owner.cookie.split("; ").map((part) => {
          const split = part.indexOf("=");
          return {
            name: part.slice(0, split),
            value: part.slice(split + 1),
            url: origin,
            httpOnly: true,
            sameSite: "Lax" as const,
          };
        }),
      );
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(origin + "/settings");
      await expect(
        page.getByRole("heading", { name: "Settings", exact: true }),
      ).toBeVisible({ timeout: 20000 });
      await page
        .getByRole("button", { name: "Team & permissions", exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "Team & client permissions",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Save access", exact: true }),
      ).toHaveCount(2);
      await page.screenshot({
        path: "design/implemented/cloud-team-desktop.png",
        fullPage: true,
      });
      await page.goto(origin + "/calendar");
      await page
        .getByRole("button", { name: "Create content", exact: true })
        .click();
      const modal = page.getByRole("dialog");
      await modal.getByLabel("Post title").fill("Live browser draft");
      await modal
        .getByLabel("Caption")
        .fill("This draft was saved through the real authenticated provider.");
      await modal.getByRole("button", { name: "Save draft" }).click();
      await expect(page.getByText("Saving…", { exact: true })).toHaveCount(0);
      await expect(
        page.getByText("Live browser draft", { exact: true }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByText("Live browser draft", { exact: true }),
      ).toBeVisible();
      assert.equal(
        (
          await ok("/api/workspace?workspaceId=" + wid, team.cookie)
        ).data.data.posts.some(
          (p: { title: string }) => p.title === "Live browser draft",
        ),
        true,
      );
      assert.deepEqual(errors, []);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(origin + "/settings");
      await expect(
        page.getByRole("heading", { name: "Settings", exact: true }),
      ).toBeVisible({ timeout: 20000 });
      await page
        .getByRole("button", { name: "Team & permissions", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Save access", exact: true }),
      ).toHaveCount(2);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "Cloud controls must fit mobile width.",
      );
      await page.screenshot({
        path: "design/implemented/cloud-settings-mobile.png",
        fullPage: true,
      });
      console.log(
        "PASS: real browser team screen and draft save/reload shared with the second user",
      );
    } finally {
      await browser.close();
    }
    // Verify recovery/invitation token handling without sending email to anyone.
    const recovery = await admin.auth.admin.generateLink({
      type: "recovery",
      email: team.email,
    });
    if (recovery.error) throw new Error(recovery.error.message);
    const confirm = await fetch(
      origin +
        "/auth/confirm?type=recovery&token_hash=" +
        encodeURIComponent(recovery.data.properties.hashed_token),
      { redirect: "manual" },
    );
    assert.equal(confirm.status, 307);
    assert.ok(confirm.headers.get("location")?.endsWith("/auth/password"));
    assert.ok(confirm.headers.getSetCookie().length);
    console.log(
      "PASS: recovery token establishes a server session and opens password setup",
    );
    await ok("/api/team", owner.cookie, {
      action: "manage",
      workspaceId: wid,
      userId: team.id,
      role: "team_member",
      clientIds: [],
      remove: true,
    });
    assert.equal(
      (await ok("/api/workspace?workspaceId=" + wid, team.cookie)).data.session,
      null,
    );
    const logout = await ok("/api/auth", reviewer.cookie, { action: "logout" });
    assert.ok(
      logout.response.headers
        .getSetCookie()
        .some((c) => c.includes("Max-Age=0")),
    );
    assert.equal((await api("/api/workspace")).response.status, 401);
    console.log(
      "PASS: access removal is enforced and logout clears the browser session",
    );
  } finally {
    if (path) {
      const r = await admin.storage.from("grailhiiv-assets").remove([path]);
      if (r.error)
        throw new Error("Test file cleanup failed: " + r.error.message);
    }
    if (importWid) {
      const existing = await admin
        .from("workspaces")
        .select("name")
        .eq("id", importWid)
        .single();
      assert.equal(existing.data?.name, "GrailHiiv import smoke " + run);
      const removed = await admin
        .from("workspaces")
        .delete()
        .eq("id", importWid);
      if (removed.error)
        throw new Error(
          "Import fixture cleanup failed: " + removed.error.message,
        );
    }
    if (wid) {
      const existing = await admin
        .from("workspaces")
        .select("name")
        .eq("id", wid)
        .single();
      assert.equal(existing.data?.name, "GrailHiiv smoke " + run);
      const r = await admin.from("workspaces").delete().eq("id", wid);
      if (r.error)
        throw new Error("Test workspace cleanup failed: " + r.error.message);
    }
    for (const user of users) {
      const result = await admin.auth.admin.deleteUser(user.id);
      if (result.error)
        throw new Error("Test user cleanup failed: " + result.error.message);
    }
    console.log(
      "Removed this run's isolated test users, workspace and uploaded object.",
    );
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Verification failed.",
  );
  process.exitCode = 1;
});
