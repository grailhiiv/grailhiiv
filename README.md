# GrailHiiv

A client social-media workspace with Supabase authentication, client permissions, PostgreSQL persistence and private asset storage. Technical identifiers use `grailhiiv`; the visible brand is GrailHiiv.

## Supabase setup

Copy `.env.example` to `.env` and set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `GRAILHIIV_SITE_URL`. The app, npm workers and Docker Compose share this single configuration file. Run `npm.cmd run setup:selfhost` to fill missing deployment secrets or consolidate legacy environment files; existing credentials are preserved and conflicting values stop the merge. Docker supplies its internal service addresses separately. The service-role key is server-only and is used for invitation emails. Normal reads and writes use the signed-in user's token, so RLS remains enforced. `.env` is ignored by Git; `.env.example` contains no actual credentials.

For a new project, apply the SQL files in `supabase/migrations` in filename order in your Supabase project's SQL Editor, or use Supabase CLI migrations. These create eight public tables, narrow mutation functions, read policies, the private `grailhiiv-assets` bucket and an atomic empty-workspace import. The migrations are one-time installs, not idempotent reset scripts. Never rerun installation migrations against an installed database.

For an existing Phase 1 installation, apply only `20261009183529_harden_assets_and_posts.sql`. It rejects demo assets with private storage paths, binds uploaded paths to exact workspace/client folders, independently enforces these checks on storage reads, and validates required post fields, notes, metrics and status at the RPC boundary. It changes functions and a storage policy without deleting records. The connected project already had equivalent hardened functions when this repository repair was prepared; its newer live schema was not overwritten. Workspace reads also validate persisted payloads before returning them to the UI.

In Supabase Authentication → URL Configuration, set Site URL to the canonical app origin, currently `http://127.0.0.1:3100`. Allow the exact `/auth/callback`, `/auth/callback?next=/auth/password` and `/auth/password` URLs for this origin. `http://localhost:3100` aliases can be allowed for local development. Use your HTTPS domain for production.

The default Supabase invitation/recovery templates are supported: fragment tokens are immediately removed from the browser URL and exchanged on the server for HttpOnly cookies. Signup/recovery PKCE callbacks are also supported. If custom SMTP and editable email templates are available, you can use these links in the confirmation, invitation and recovery templates respectively:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Confirm your email</a>
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite">Accept your invitation</a>
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">Reset your password</a>
```

These links establish a server cookie session without requiring the original browser's PKCE verifier. Supabase email delivery settings, sender restrictions and rate limits still apply; configure custom SMTP before inviting external customers. Keep email confirmation enabled.

Create your account and confirm your email, then create your agency workspace. Create the first client or explicitly import this browser's demo records into an empty workspace. Import preserves the original localStorage/IndexedDB data; posts become drafts, browser-only uploads and past approval/activity history are excluded, and client-specific workflows import disabled with no simulated runs. Agency-wide demo workflows are excluded because they have no client scope.

## Roles and persistence

| Role | Access |
| --- | --- |
| Owner | All clients; manage workspace, invitations and membership |
| Team Member | Edit assigned clients' content, leads, tasks, assets and workflow definitions; cannot approve posts requiring review |
| Client Reviewer | Read assigned clients' content and assets; append feedback and approve/request changes on submitted posts; no CRM access |

Owners assign client access in Settings → Team & permissions. Invitations expire after seven days and are claimed only by the invited email's verified account. Owners can revoke pending invitations, reassign clients, change roles or remove members. The owner cannot remove their own access.

Clients are stored in `clients`; content, CRM leads, follow-up tasks, asset metadata and workflow definitions are stored in client-scoped `records`. Follow-up tasks mirror the lead form's task and due-date fields. `approvals` stores the actor, record revision and approved content snapshot; `activity_log` records database-verified changes. Payloads retain the existing UI schema while indexed workspace/client/kind columns enforce access. Direct table writes are denied to application roles; authenticated RPCs validate access and perform atomic commits.

Saves check each record's previous payload to reject stale edits from other devices. Shared screens refresh on focus and every 15 seconds while idle. Saving and errors remain visible; a failed save blocks further editing until Refresh restores shared records. Edits to scheduled content return to Draft and need approval again. Scheduling saves approved records. Enabled Facebook/Instagram destinations can publish them through the approval-aware social worker; delivery receipts update the calendar.

Assets upload to a private Supabase bucket with workspace/client/object paths. The app accepts PNG, JPEG, WebP, GIF, MP4 and PDF up to 10 MB per file, checks MIME signatures and disallows SVG. RLS restricts object reads to assigned clients with asset metadata; reviewers cannot upload. The download endpoint verifies membership and returns a 60-second signed URL. A signed link remains usable until expiry even after access is revoked; authenticated requests check current access. Storage quotas/billing are governed by your Supabase plan. This milestone does not add malware scanning, thumbnail processing or off-server backups.

## Run locally

Requires Node.js 22 or newer and npm.

```powershell
cd C:\Users\Gbeltran\Desktop\GrailHiiv
npm.cmd install
npm.cmd run dev -- --port 3100
```

Open http://127.0.0.1:3100. For an optimized build, run `npm.cmd run build`, then `npm.cmd run start -- --port 3100`.

## Implemented

- Overview, Content Calendar, Approvals, Leads & CRM, Automations, Asset Library, Reports, and Settings.
- Client switching across content, leads, assets, reports, and workflows.
- Create/edit drafts; assign assets and publishing dates; submit for review; add feedback; request changes; approve into the local schedule.
- Lead creation, pipeline stages (including drag/drop), notes, and follow-up tasks.
- Demo workflow definitions and simulations; authenticated workspaces can connect administrator-configured n8n workflows, queue manual runs and view durable execution history.
- Browser asset uploads using IndexedDB, client assignment, approval, downloads, and content reuse. Demo upload limit: 10 MB per file.
- Filtered sample performance reports and CSV export.
- Client creation, brand voice/audience preferences, notification preference, and JSON workspace export.
- Responsive layout, keyboard-accessible dialogs, and reduced-motion support.

## Local sample mode and remaining integrations

With Supabase configured, the application requires sign-in and loads only authorized PostgreSQL records; it does not load browser demo records automatically. Without Supabase, development uses the original local sample workspace. Production requires an explicit `GRAILHIIV_DEMO_MODE=true` to expose sample mode; otherwise a setup page appears. Sample records still persist in localStorage and sample uploads in IndexedDB and are independent of shared data.

Authenticated workspaces can generate content plans through the LangChain/LangGraph worker, with an administrator model catalog, persistent PostgreSQL checkpoints and explicit proposal acceptance before draft creation. See [AI agent setup](deploy/AI-AGENTS.md). Sample mode retains labeled templates. Facebook/Instagram publishing is available through configured Meta connections; see [social publishing setup](deploy/SOCIAL-PUBLISHING.md). Demo automation runs remain simulations. Authenticated workspaces can use the self-hosted n8n bridge when configured: a separate worker dispatches queued manual runs and authenticated callbacks record results. Internal triggers are available; external CRM handlers, other social platforms and live analytics remain unconnected. Reports use illustrative seeded metrics.

## Self-hosted automations

Internal operations are available in **Settings → AI Preferences**: AI reasoning and usage limits, worker/backup status, upload quotas and opt-in event/scheduled rules. Draft proposals support edits, dates/assets and single-caption regeneration. New image uploads receive private thumbnails. Local backups are encrypted and verified with isolated database restores. See [internal operations](deploy/INTERNAL-OPERATIONS.md) for defaults, backup scheduling and recovery boundaries.

See [the self-hosting guide](deploy/SELF-HOSTING.md) for the Compose stack, one-time database migration, secret generation, n8n administrator setup and the importable connection-check workflow. Owners manage workflow connections in GrailHiiv; team members run enabled workflows for assigned clients. The n8n editor remains administrator-only. No external messages or publishing actions are performed by the starter workflow.

The local server binds to `127.0.0.1`. This unauthenticated demo should not be exposed as a production client portal.

## Next integration phase

1. Lead capture through n8n with validation, duplicate protection, persistent history and follow-up tasks.
2. Extend the implemented draft agent with additional tools after external integrations and their approval checks are ready.
3. Extend Facebook/Instagram publishing to video, additional social platforms and analytics synchronization.
4. Supabase storage backups, operational quotas and thumbnail processing; Hetzner migration if needed later.

Keep LangGraph in charge of agent state and n8n in charge of external workflow execution. The backend must validate workspace membership and approved post versions before any publishing action.

## Checks

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npx.cmd playwright install chromium
npm.cmd run test:browser
```

Browser tests cover navigation, creation/approval persistence, client filters, CRM changes, IndexedDB uploads, workflow simulation, report download, settings, and mobile layout. Visual captures are saved to `design/implemented`; original generated references are in `design/mockups`.

`npm.cmd test` also executes the actual migration SQL in embedded PostgreSQL (PGlite), with authenticated role/JWT fixtures, testing RLS, role escalation attempts, approvals, optimistic concurrency, private storage policies and revocation. `npm.cmd run test:cloud-ui` exercises the running cloud UI with mocked API responses. `npm.cmd run test:supabase` exercises real Supabase users and the running app with isolated fixtures; it requires the server-only key and cleans up only its generated users, workspace and file. It sends no invitation or recovery emails. Never publish that key in test output.

The original `test:browser` suite targets sample mode. To verify it alongside the cloud app, build and start a separate sample build on port 3101 with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` empty, `GRAILHIIV_DEMO_MODE=true`, and `GRAILHIIV_DIST_DIR=.next-demo`; run `npx.cmd playwright test --config playwright.demo.config.ts`.

The visual fidelity pass uses a locally hosted Roboto font and reference-measured desktop layouts at 1536 × 1024. Fifty photos, thumbnails, avatars and logo crops are extracted directly from the mockups and verified against their original pixels. See `design/DESIGN.md` and `public/media/mockup/provenance.json` for measurements and asset origins. The raster mockups do not identify their source font or include original full-resolution photos; the UI is a close functional translation, not an asserted pixel-perfect copy. Existing browser records are retained. Mockup file sizes/dimensions are sample metadata; the video example is a still image.

## Project guidance

The existing `.agents` skill library and `.codex/config.toml` belong to this project. The Image-to-Code and Vercel React Best Practices skills were consulted for the first version. No changes were made to those files. Agent context/model settings are separate from application runtime configuration.
