import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";

const marker = "/home/node/.n8n/grailhiiv-bootstrap-v1";
if (!existsSync(marker)) {
  const secret = process.env.GRAILHIIV_N8N_WEBHOOK_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("Configure the webhook secret.");
  const credentials = "/home/node/.n8n/grailhiiv-credentials.json";
  const workflows = "/home/node/.n8n/grailhiiv-workflow.json";
  writeFileSync(
    credentials,
    JSON.stringify([
      {
        id: "grailhiivWebhookAuth",
        name: "GrailHiiv webhook",
        type: "httpHeaderAuth",
        data: { name: "X-GrailHiiv-Secret", value: secret },
      },
    ]),
    { mode: 0o600 },
  );
  writeFileSync(workflows, readFileSync("/setup/connection-check.json"), {
    mode: 0o600,
  });
  try {
    for (const [command, path] of [
      ["import:credentials", credentials],
      ["import:workflow", workflows],
    ]) {
      const result = spawnSync("n8n", [command, `--input=${path}`], {
        stdio: "inherit",
      });
      if (result.status !== 0)
        throw new Error("n8n bootstrap failed. Check database configuration.");
    }
    writeFileSync(
      marker,
      "Imported. Create the administrator account and publish the workflow.\n",
      { mode: 0o600 },
    );
  } finally {
    unlinkSync(credentials);
    unlinkSync(workflows);
  }
} else
  console.log(
    "GrailHiiv workflow already imported; preserving administrator edits.",
  );
