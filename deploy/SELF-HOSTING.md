# Self-hosted GrailHiiv and n8n

GrailHiiv owns authentication, client access, workflow connections and execution history. n8n runs as an administrator-managed backend service. The existing Automations screen queues manual runs, shows results and lets owners bind saved automations to an operator-approved catalog. The n8n editor is separate and bound to localhost.

The stack contains the Next.js app, an automation worker, n8n and a dedicated PostgreSQL database for n8n. GrailHiiv continues using its configured Supabase project; n8n never receives the Supabase service-role key. n8n's database is not the application's database.

## First start

Requires Docker Engine/Desktop with Compose v2. On Windows, use Docker Desktop with its Linux container backend. Stop any existing GrailHiiv dev server using port 3100 before starting the stack.

1. Apply `supabase/migrations/20261010071129_n8n_automation_bridge.sql` once in your existing Supabase project's SQL Editor. On a new Supabase project, apply all migration files in filename order. Do not rerun installation migrations on an installed database. This adds two tables and four RPCs without changing application records.
2. From the project folder, prepare the shared environment:

   ```powershell
   cd C:\Users\Grail\Desktop\GrailHiiv
   npm.cmd run setup:selfhost
   notepad.exe .env
   ```

   The setup script merges any legacy `.env.selfhost`, `.env.n8n-admin` and `.env.local` settings into `.env`. It rejects conflicting nonempty values before writing, preserves existing credentials, generates only missing n8n/AI database secrets, verifies the merged contents and removes the superseded files. Re-running it keeps existing passwords and encryption keys. Fill any missing Supabase values. Only `.env` contains your actual configuration; `.env.example` is the shareable template without credentials. Both npm scripts and Compose use `.env`.
3. Validate without printing resolved secrets, then build and start:

   ```powershell
   docker compose --env-file .env config --quiet
   docker compose --env-file .env up -d --build
   docker compose --env-file .env ps
   ```

4. Open `http://127.0.0.1:5678` and create the n8n administrator account. Import the authenticated connection-check workflow using the one-time setup service:

   ```powershell
   docker compose --env-file .env --profile setup run --rm n8n-bootstrap
   ```

   In the n8n editor, open **GrailHiiv — Verify automation connection**, confirm its Webhook uses the **GrailHiiv webhook** header credential, then **Publish** it. The bootstrap imports it unpublished and uses a persistent marker to preserve subsequent administrator edits. Run bootstrap only after creating the administrator account.
5. Open `http://127.0.0.1:3100`, sign in as a workspace owner, and open Automations. Create a client-scoped automation, choose **Verify automation connection**, enable it, and click **Run workflow**. History should move from Queued to Running to Success with an n8n execution ID. Reload to confirm history persists. This starter performs no external actions.

The Compose stack checks app/n8n health and starts the worker when both are ready. A reachable n8n health endpoint does not prove the worker, workflow publication or callback is working; the connection-check run verifies the complete path.

## Add an administrator-managed workflow

Create a workflow in n8n with a POST Webhook, a single safe path such as `grailhiiv-client-followup`, **Header Auth** using the `GrailHiiv webhook` credential, and an immediate 202 response. Publish it. Add its key, display label and webhook path to `GRAILHIIV_N8N_WORKFLOWS` in `.env`; keys and paths accept only letters, numbers, underscores and hyphens. Recreate app and worker after editing the catalog:

```powershell
docker compose --env-file .env up -d app automation-worker
```

Owners can then select it in GrailHiiv. The browser can select a key; it cannot supply a webhook URL, credentials or arbitrary workflow parameters. Only an operator controlling deployment configuration can extend the catalog. Owner bindings are stored independently of editable automation records.

The webhook receives `runId`, `workspaceId`, `clientId`, `automationId`, `automationName`, `workflowKey`, `callbackUrl` and `callbackToken`. These identify the authorized run; they are not database credentials or a general-purpose authorization token. Use `runId` as the idempotency key for downstream services that support it.

At the end of the workflow, POST to `callbackUrl` with `Authorization: Bearer <callbackToken>` and a JSON result containing `status` (Success or Failed), `detail` (1–1000 characters) and `executionId` (the n8n execution ID as a string). Configure a failure branch to report Failed as well. Do not include credentials, full upstream error responses or personal lead data in `detail`. The starter JSON shows the HTTP Request node expressions.

Callbacks can only complete their own Running run, and cannot modify clients, posts, approvals or leads. Completion expires after 15 minutes. Repeated callbacks with the same outcome/execution ID are acknowledged without overwriting the original result; conflicting or late results are rejected.

## Queue and permissions

- Owners connect/disconnect workflows. Owners and assigned team members can run enabled automations; reviewers cannot read bindings/history or start runs.
- A request UUID prevents duplicate queue insertion. Only one Queued/Running run is allowed per automation. The worker checks current membership, client assignment, binding and enabled state again before dispatch.
- The queue persists in Supabase across app/worker restarts. The worker never automatically redispatches a claimed job. A missed callback, ambiguous delivery or worker crash becomes Unknown, because the external action might already have happened. Check n8n/downstream receipts before starting another run. Requests not claimed within one hour fail without being dispatched. Expiry is processed while the worker is running.
- Disabling prevents queued jobs from dispatching. It does not interrupt an already running n8n execution. Deleting an automation deletes its binding/history through foreign keys; it does not cancel an external action already dispatched.
- Outcomes are stored in `automation_runs`; legacy `records.payload.runs` remains demo history and cannot forge live results. UI history is the latest 200 authorized runs in the workspace, filtered by visible automations; it refreshes every five seconds while the page is visible.
- Automatic schedules/event triggers, lead ingestion, social publishing and analytics are separate integration work. No workflow in this change changes a post to Published. Future publishing handlers must check current membership and the exact approved content version immediately before each external action.

## Local app with containerized n8n

You may start only `n8n-db` and `n8n` with Compose and run the app/worker using npm. Complete the same bootstrap and publication steps. Add n8n settings from `.env.example` to the existing local app environment, with `GRAILHIIV_N8N_URL=http://127.0.0.1:5678` and `GRAILHIIV_N8N_CALLBACK_URL=http://host.docker.internal:3100`. The webhook secret must match n8n's header credential; the callback secret must match app and worker. Both secrets must be different and at least 32 characters.

For callbacks from a container, the app must listen on a reachable interface. Run `npm.cmd run dev -- --hostname 0.0.0.0 --port 3100` and allow only the Docker network through the host firewall. Start the separate worker with `npm.cmd run worker:n8n`. Keep the browser's canonical origin in `GRAILHIIV_SITE_URL`; the callback origin is separately configured.

## Operations

Ports 3100 and 5678 bind to localhost. For production, put GrailHiiv behind an HTTPS reverse proxy, update `GRAILHIIV_SITE_URL` and Supabase redirect URLs, and expose the n8n editor only to administrators (for example through an SSH tunnel). If exposing the editor through an HTTPS proxy, set `N8N_EDITOR_BASE_URL`, `N8N_SECURE_COOKIE=true` and configure n8n's proxy settings for that topology. The worker-to-n8n and n8n-to-app URLs stay on the Compose network.

Retain both named volumes and the n8n encryption key. Back up PostgreSQL, `/home/node/.n8n` and the deployment environment securely; restore-test them. Do not use `docker compose down --volumes` for routine restarts. Image versions are pinned; test upgrades before changing them. The worker intentionally has no n8n management API key, and n8n has no application database key.

n8n execution bodies are not retained by the supplied workflow/global settings because they contain run callback tokens. Execution IDs and safe results are retained in GrailHiiv. Do not turn execution-body retention on without redacting callback tokens. To rotate the webhook secret, update the n8n header credential and app/worker environment together. To rotate the callback secret, let current runs finish first, then update app and worker together. Retain `N8N_ENCRYPTION_KEY` for the lifetime of existing encrypted credentials.

Check the applicable n8n license before offering customer credential integrations. Surfacing its editor inside your product requires an OEM agreement. This setup keeps the editor administrator-only and does not assume self-hosting grants every commercial use.

References: [Docker deployment](https://docs.n8n.io/deploy/host-n8n/install-options/install-using-docker-compose.md), [Webhook authentication](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook), [CLI imports](https://docs.n8n.io/deploy/host-n8n/configure-n8n/use-the-command-line.md), [OEM integration](https://docs.n8n.io/deploy/host-n8n/deploy-as-an-oem-integration.md).
