# AI content agents

The content-plan dialog in an authenticated workspace queues a LangGraph job. A separate Node worker reads only that client's name, description, brand voice and audience, then calls a configured OpenAI or Anthropic model through LangChain with a validated five-post output schema. No CRM records, email addresses or assets are sent to the provider. The brief and brand fields are sent to the chosen provider; use your provider account's data-handling settings as appropriate.

The graph pauses before the `create_content_drafts` tool. Open **Overview → Draft Plan**, select the client and model, and enter a brief. The dialog moves from Create to Generating to Review, replacing the form with the generated captions. Review all five posts, then choose **Create 5 Drafts** or **Reject Proposal** in the fixed footer. A pending plan reopens directly in Review; the UI calls this **Ready for Review** to distinguish it from post approval. After completion, **View Drafts** selects the plan's client and opens **Content Calendar → Unscheduled Ideas**. Recent completed or rejected plans remain available under **Recent Plans** in the create step. Owners and assigned team members can accept creation of drafts. This decision does not approve posts for scheduling: the existing owner/client-reviewer rules still apply when submitting the resulting drafts. The agent has no publishing, messaging, scheduling or arbitrary HTTP tool. n8n remains responsible for external workflow execution.

## Local setup

1. Apply `supabase/migrations/20261010120000_ai_agents.sql` once to an existing installation after its previous migrations. This adds the queue and permission-checked functions without modifying existing posts. For a new project, apply all migrations in filename order.
2. Edit the shared `.env`. Add `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY`, the existing Supabase URL/service-role key, `GRAILHIIV_AI_DATABASE_URL`, and `GRAILHIIV_AI_MODELS`. Keep these values server-only. For a worker started with npm, use a dedicated PostgreSQL database for checkpoints, or a direct/session connection to PostgreSQL with permission to create the private `grailhiiv_agent` schema. Do not use a transaction-pool connection. Percent-encode special characters in connection-string credentials; keep TLS verification enabled for remote databases. For the Docker setup below, Compose supplies `GRAILHIIV_AI_DATABASE_URL` automatically using `AI_POSTGRES_PASSWORD`; leave the local URL blank.
3. The catalog is a JSON array. Replace `YOUR_PROVIDER_MODEL_ID` with an exact model ID available to your account. Keys must be unique; the browser receives only keys and labels. The app and worker must have the same catalog and provider credentials. A catalog entry without a provider key is unavailable.

   ```dotenv
   GRAILHIIV_AI_MODELS='[{"key":"content","label":"Content writer","provider":"openai","model":"YOUR_PROVIDER_MODEL_ID","maxTokens":4096}]'
   ```

   Use `"provider":"anthropic"` for Anthropic. The worker supports providers' structured-output/tool-calling APIs; choose a model that supports them. Changing a catalog entry invalidates jobs queued with the old configuration.
4. Initialize checkpoints once, then start the worker in a separate terminal:

   ```powershell
   cd C:\Users\Grail\Desktop\GrailHiiv
   npm.cmd run setup:ai
   npm.cmd run worker:ai
   ```

   Restart the Next.js app after changing its environment. Checkpoint setup is repeatable; it revokes browser roles' access to the private schema and tables. Do not expose that schema in Supabase's Data API. Provider keys and connection strings never enter the browser or job rows.

## Compose

Run `npm.cmd run setup:selfhost` to prepare the shared `.env`; this generates `AI_POSTGRES_PASSWORD` only if missing. Add `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` and the model catalog to `.env`. For a new installation, you can also generate a URL-safe database password manually:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
notepad.exe .env
```

In Notepad, paste the new variables at the end and press **Ctrl+S**, then **Alt+F4**. Apply the Supabase migration first, then run:

```powershell
docker compose --env-file .env --profile ai config --quiet
docker compose --env-file .env --profile ai up -d --build
docker compose --env-file .env --profile ai ps
```

The optional profile adds a dedicated internal PostgreSQL service with the `agent_db` volume, a checkpoint setup job, and the AI worker. Checkpoint PostgreSQL has no published host port and is separate from n8n's database. Keep the volume and its password when upgrading; back it up together with the application's Supabase data. Never use `down -v` to upgrade.

## Recovery and boundaries

- Each request UUID identifies one immutable brief/model/client job. Duplicate submissions return that job. One active run is allowed per client; a workspace can queue at most 30 jobs per hour.
- Workers claim jobs with a five-minute lease. After a process crash, a worker can reclaim an expired lease and continue saved graph nodes using the workspace/run thread ID. After three claims without completion the job fails. Provider calls have timeouts and one SDK retry; a crash before a model response is checkpointed can cause a repeated provider call and charge.
- The proposal remains checkpointed while waiting for a human. Decisions are recorded with actor/time in Supabase and resumed with a structured LangGraph command. Closing/reopening the dialog retains history. Accepting creates exactly five unscheduled Draft records in one transaction, using deterministic IDs, and logs the action. Duplicate decisions do not duplicate posts. Rejecting creates no posts.
- Current client access is checked at enqueue, claim, context reads, decisions and draft saving. The service key never substitutes for the initiating/accepting user's permissions. Revocation blocks future tool effects; data already sent to a provider cannot be recalled. Editing brand preferences after generation does not regenerate an already displayed proposal.
- Failed runs show a safe message. Fix configuration/provider availability and start a new run. No upstream response bodies or secrets are logged. Model output cannot select a client, supply IDs, change a post status, or approve publication.
- History displays the latest 50 authorized workspace runs. Checkpoints and proposals persist until an operator removes them under an appropriate retention policy; automatic pruning is not implemented. Demo mode retains the clearly labeled starter templates and makes no paid provider calls.

## Verification

`npm.cmd test` executes the migration in embedded PostgreSQL and exercises the real PostgresSaver SQL and serialization across graph recreation. Tests cover permissions, proposal validation, leases, revocation, duplicate requests/decisions, rejection and draft-only saving. `npm.cmd run test:cloud-ui` tests model selection, brief submission, proposal review and history against mocked API responses in a real browser. These checks do not prove live provider credentials or remote deployment; verify one real generation after configuring and starting the worker.

Implementation follows LangGraph's [persistent checkpointer](https://docs.langchain.com/oss/javascript/langgraph/add-memory) and [interrupt/resume](https://docs.langchain.com/oss/javascript/langgraph/interrupts) APIs. The pinned package versions and lockfile are the runtime contract for this implementation.
