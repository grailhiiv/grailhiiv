# GrailHiiv

A local, interactive first version of the client social-media workspace. Technical identifiers use `grailhiiv`; the visible brand is GrailHiiv.

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
- Local workflow definitions, enable/disable controls, and explicitly simulated runs.
- Browser asset uploads using IndexedDB, client assignment, approval, downloads, and content reuse. Demo upload limit: 10 MB per file.
- Filtered sample performance reports and CSV export.
- Client creation, brand voice/audience preferences, notification preference, and JSON workspace export.
- Responsive layout, keyboard-accessible dialogs, and reduced-motion support.

## What is still a demo

There is no authentication or server database yet. Workspace records persist in this browser's localStorage, and uploaded files persist in IndexedDB. Different browsers/devices do not share data. Clearing browser storage removes local changes. Use demo information until authentication and the database are connected.

The AI content-plan button creates editable templates; it does not call an AI model. Scheduling does not publish to social accounts. Automation runs do not call n8n or a CRM. Reports use illustrative seeded metrics, not live analytics. There is no scheduler or background worker process yet.

The local server binds to `127.0.0.1`. This unauthenticated demo should not be exposed as a production client portal.

## Next integration phase

1. Supabase Auth, server sessions, client membership policies, and PostgreSQL persistence.
2. Server-controlled asset storage on Hetzner with client permissions and off-server backups.
3. LangChain/LangGraph worker, persistent checkpoints, model configuration, and approval-aware tools.
4. Self-hosted n8n webhooks with signed requests, retries, and idempotency; service credentials stay on the server.
5. CRM and official social connections, publishing, and analytics synchronization.

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

The visual fidelity pass uses a locally hosted Roboto font and reference-measured desktop layouts at 1536 × 1024. Fifty photos, thumbnails, avatars and logo crops are extracted directly from the mockups and verified against their original pixels. See `design/DESIGN.md` and `public/media/mockup/provenance.json` for measurements and asset origins. The raster mockups do not identify their source font or include original full-resolution photos; the UI is a close functional translation, not an asserted pixel-perfect copy. Existing browser records are retained. Mockup file sizes/dimensions are sample metadata; the video example is a still image.

## Project guidance

The existing `.agents` skill library and `.codex/config.toml` belong to this project. The Image-to-Code and Vercel React Best Practices skills were consulted for the first version. No changes were made to those files. Agent context/model settings are separate from application runtime configuration.
