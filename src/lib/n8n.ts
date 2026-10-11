// Server/worker code only. Never import this module from a client component.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const key = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const workflow = z
  .object({
    key,
    label: z.string().min(1).max(100),
    path: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  })
  .strict();
export function n8nConfig(
  env: Record<string, string | undefined> = process.env,
) {
  if (!env.GRAILHIIV_N8N_URL) return null;
  const base = new URL(env.GRAILHIIV_N8N_URL);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/"
  )
    throw new Error("n8n URL must be an HTTP(S) origin.");
  const webhookSecret = env.GRAILHIIV_N8N_WEBHOOK_SECRET || "";
  const callbackSecret = env.GRAILHIIV_N8N_CALLBACK_SECRET || "";
  if (
    webhookSecret.length < 32 ||
    callbackSecret.length < 32 ||
    webhookSecret === callbackSecret
  )
    throw new Error(
      "Configure two different n8n secrets of at least 32 characters.",
    );
  const workflows = z
    .array(workflow)
    .min(1)
    .max(50)
    .parse(JSON.parse(env.GRAILHIIV_N8N_WORKFLOWS || "[]"));
  if (new Set(workflows.map((w) => w.key)).size !== workflows.length)
    throw new Error("n8n workflow keys must be unique.");
  return { base: base.origin, webhookSecret, callbackSecret, workflows };
}
export function callbackToken(runId: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`grailhiiv:n8n:${runId}`)
    .digest("hex");
}
export function validCallbackToken(
  runId: string,
  supplied: string,
  secret: string,
) {
  const expected = callbackToken(runId, secret);
  return (
    /^[a-f0-9]{64}$/.test(supplied) &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
  );
}
export const automationInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("bind"),
      workspaceId: z.string().uuid(),
      automationId: key,
      workflowKey: key.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("run"),
      workspaceId: z.string().uuid(),
      automationId: key,
      requestId: z.string().uuid(),
    })
    .strict(),
]);
export const resultInput = z
  .object({
    status: z.enum(["Success", "Failed"]),
    detail: z.string().min(1).max(1000),
    executionId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  })
  .strict();

export type DispatchRun = {
  id: string;
  workspace_id: string;
  client_id: string;
  automation_id: string;
  workflow_key: string;
  automation_name: string;
};
export async function dispatchRun(
  run: DispatchRun,
  config: NonNullable<ReturnType<typeof n8nConfig>>,
  callbackBase: string,
  request: typeof fetch = fetch,
) {
  const selected = config.workflows.find((w) => w.key === run.workflow_key);
  if (!selected) throw new Error("Workflow is no longer configured.");
  const callbackOrigin = new URL(callbackBase);
  if (
    !["http:", "https:"].includes(callbackOrigin.protocol) ||
    callbackOrigin.username ||
    callbackOrigin.password ||
    callbackOrigin.pathname !== "/" ||
    callbackOrigin.search ||
    callbackOrigin.hash
  )
    throw new Error("Callback URL must be an HTTP(S) origin.");
  return request(`${config.base}/webhook/${selected.path}`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: {
      "Content-Type": "application/json",
      "X-GrailHiiv-Secret": config.webhookSecret,
    },
    body: JSON.stringify({
      runId: run.id,
      workspaceId: run.workspace_id,
      clientId: run.client_id,
      automationId: run.automation_id,
      automationName: run.automation_name,
      workflowKey: run.workflow_key,
      callbackUrl: `${callbackOrigin.origin}/api/automations/callback/${run.id}`,
      callbackToken: callbackToken(run.id, config.callbackSecret),
    }),
  });
}
