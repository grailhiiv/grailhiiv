import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  n8nConfig,
  callbackToken,
  validCallbackToken,
  dispatchRun,
  automationInput,
  resultInput,
} from "../src/lib/n8n";

const env = {
  GRAILHIIV_N8N_URL: "http://127.0.0.1:5678",
  GRAILHIIV_N8N_WEBHOOK_SECRET: "w".repeat(64),
  GRAILHIIV_N8N_CALLBACK_SECRET: "c".repeat(64),
  GRAILHIIV_N8N_WORKFLOWS: JSON.stringify([
    { key: "check", label: "Connection check", path: "check" },
  ]),
};
test("workflow catalog rejects URL injection, duplicate keys and weak/shared secrets", () => {
  assert.equal(n8nConfig({}), null);
  for (const patch of [
    { GRAILHIIV_N8N_URL: "file:///etc/passwd" },
    { GRAILHIIV_N8N_URL: "https://secret@example.com" },
    { GRAILHIIV_N8N_URL: "https://example.com/admin?token=secret" },
    { GRAILHIIV_N8N_WEBHOOK_SECRET: "weak" },
    { GRAILHIIV_N8N_CALLBACK_SECRET: env.GRAILHIIV_N8N_WEBHOOK_SECRET },
    {
      GRAILHIIV_N8N_WORKFLOWS:
        '[{"key":"check","label":"Test","path":"../admin"}]',
    },
    {
      GRAILHIIV_N8N_WORKFLOWS: JSON.stringify(
        Array(2).fill({ key: "check", label: "Test", path: "check" }),
      ),
    },
  ])
    assert.throws(() => n8nConfig({ ...env, ...patch }));
  assert.throws(() =>
    automationInput.parse({
      action: "run",
      workspaceId: crypto.randomUUID(),
      automationId: "a",
      requestId: crypto.randomUUID(),
      url: "https://evil.test",
    }),
  );
  assert.throws(() =>
    resultInput.parse({
      status: "Published",
      detail: "Forged",
      executionId: "1",
    }),
  );
});
test("callback credentials authorize only their own run", () => {
  const id = crypto.randomUUID(),
    other = crypto.randomUUID();
  const token = callbackToken(id, env.GRAILHIIV_N8N_CALLBACK_SECRET);
  assert.equal(
    validCallbackToken(id, token, env.GRAILHIIV_N8N_CALLBACK_SECRET),
    true,
  );
  assert.equal(
    validCallbackToken(other, token, env.GRAILHIIV_N8N_CALLBACK_SECRET),
    false,
  );
  for (const value of ["", token.slice(1), "x".repeat(64), "0".repeat(64)])
    assert.equal(
      validCallbackToken(id, value, env.GRAILHIIV_N8N_CALLBACK_SECRET),
      false,
    );
});
test("real HTTP dispatch authenticates the webhook and sends a scoped callback, never a database key", async (t) => {
  let received:
    | {
        headers: Record<string, unknown>;
        path: string;
        body: Record<string, string>;
      }
    | undefined;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    received = {
      headers: req.headers,
      path: req.url!,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    };
    res.writeHead(202);
    res.end("{}");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const port = (server.address() as { port: number }).port;
  const config = n8nConfig({
    ...env,
    GRAILHIIV_N8N_URL: `http://127.0.0.1:${port}`,
  })!;
  const run = {
    id: crypto.randomUUID(),
    workspace_id: crypto.randomUUID(),
    client_id: "client-a",
    automation_id: "a",
    automation_name: "Test",
    workflow_key: "check",
  };
  const response = await dispatchRun(run, config, "http://app:3100");
  assert.equal(response.status, 202);
  await response.body?.cancel();
  assert.equal(received!.path, "/webhook/check");
  assert.equal(
    received!.headers["x-grailhiiv-secret"],
    env.GRAILHIIV_N8N_WEBHOOK_SECRET,
  );
  assert.equal(
    received!.body.callbackUrl,
    `http://app:3100/api/automations/callback/${run.id}`,
  );
  assert.equal(
    validCallbackToken(
      run.id,
      received!.body.callbackToken,
      config.callbackSecret,
    ),
    true,
  );
  assert.equal(received!.body.workspaceId, run.workspace_id);
  assert.equal(received!.body.clientId, "client-a");
  assert.equal(
    JSON.stringify(received!.body).includes(config.callbackSecret),
    false,
  );
  assert.equal("SUPABASE_SERVICE_ROLE_KEY" in received!.body, false);
  await assert.rejects(
    dispatchRun({ ...run, workflow_key: "unknown" }, config, "http://app:3100"),
  );
  await assert.rejects(dispatchRun(run, config, "http://app:3100/path"));
});
