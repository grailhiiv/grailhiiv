# Internal operations

These features use the existing Supabase, LangGraph, n8n and local Docker installation. Internal rules do not send messages or publish posts.

## Draft editing and regeneration

In **Overview → Draft Plan → Review**, choose **Edit Plan, Dates and Assets**. Change titles, captions, platforms, draft dates/times and client assets, then save the proposal. Saving checks its previous version; another user's edits cause a conflict instead of an overwrite. **Regenerate Post N** calls the configured model for that caption only, preserves the other posts and date/asset assignments, and returns the plan for review. Regeneration consumes the same limits as other model calls.

**Create 5 Drafts** accepts the exact proposal you reviewed. Dates remain draft dates: they do not approve or publish a post. Failed runs expose a retry action. A failed draft-save attempt returns its saved proposal for review without automatically approving a new version. Approval and client access are rechecked before writes. TikTok and X drafts can also be opened in the post editor.

## AI controls and monitoring

Owners open **Settings → AI Preferences** to manage operational limits, review today's tracked usage, see worker heartbeats and backup results, and configure internal rules. Defaults are 30 AI calls/hour, 100,000 tokens/day, a disabled monetary budget (0), a 1 GB upload quota and 30-day checkpoint retention. UTC defines the AI usage day; hourly limits use a rolling hour. The OpenAI reasoning preference overrides GPT-5/6 model defaults for new calls; other providers/models retain their catalog configuration.

The model catalog supports `reasoningEffort`, `inputPricePerMillion` and `outputPricePerMillion`. Example for the existing Luna model:

```dotenv
GRAILHIIV_AI_MODELS='[{"key":"content","label":"GPT-5.6 Luna","provider":"openai","model":"gpt-5.6-luna","maxTokens":4096,"reasoningEffort":"low","inputPricePerMillion":0.2,"outputPricePerMillion":1.2}]'
```

The example's base prices and supported reasoning levels come from [official OpenAI documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna). Keep prices current for your account and model. Reported costs are estimates using configured rates, not provider invoices; cached input, long-context pricing and other provider-specific charges can differ. A daily monetary budget requires configured prices. Calls reserve conservative input/output token and cost allowances before invocation, then record provider usage when available. Missing responses keep their reservations. Tracking starts with the updated worker; older calls cannot be reconstructed. There are no hidden SDK retries; explicit retries and crash recovery can still create another provider call.

Private checkpoint cleanup removes only completed/rejected/failed threads older than their workspace retention setting. Active plans and waiting reviews are retained. Run history, usage and saved draft records remain in Supabase. Usage survives client deletion so deleting a client does not reset today's meter.

Workers report heartbeats; a healthy heartbeat expires after 90 seconds. `/api/health` now reports AI, n8n and internal-worker availability. AI availability means configuration plus a recent worker heartbeat, not a paid test of provider credentials. The public endpoint exposes no credentials, queue content or client identities.

## Asset processing and quotas

New PNG/JPEG/WebP/GIF uploads receive a rotated WebP preview bounded to 384 pixels and 128 KB. Original files are retained. Images over 25 million decoded pixels are rejected. Existing images retain their original previews; video/PDF behavior is unchanged. Private thumbnails use the same client authorization and 60-second signed-link lifetime as originals.

Workspace-locked upload reservations include previews and prevent concurrent uploads from exceeding the quota. Storage insertion checks actual object sizes and metadata checks bind saved sizes to the stored objects. Quota totals include unfinished objects; the internal worker removes expired uncommitted uploads. The quota governs this application's bucket, not the Supabase platform's billing or project-wide storage limits.

## Internal rules

Owner-created rules are disabled by default. A workspace can hold up to 50 rules. Choose **Lead Created**, **Post Approved**, or a repeating interval of at least five minutes. Actions are limited to recording workspace activity or creating a lead follow-up. Follow-ups fill an empty task using the client's timezone; an existing task is preserved. Post-approved and scheduled rules can only record activity.

Events use record/revision keys and schedules use due-time keys to avoid duplicate execution. Missed intervals coalesce into one catch-up run. Rule enablement and the configuring owner's current membership are checked at execution. Writes and success history commit together. Failed internal runs can be retried up to three attempts. Editing a rule does not move it to another client; create a separate rule for another client. No new rule is automatically enabled on deployment.

## Local encrypted backups

`npm.cmd run setup:selfhost` generates `GRAILHIIV_BACKUP_KEY` only if absent, preserving existing credentials. Keep that key separately from exported archives: the encrypted environment snapshot deliberately excludes it. `GRAILHIIV_BACKUP_DIRECTORY` defaults to `backups`, and `GRAILHIIV_BACKUP_KEEP` defaults to seven verified snapshots. The directory is excluded from Git and Docker build context.

Run a backup manually:

```powershell
cd C:\Users\Grail\Desktop\GrailHiiv
npm.cmd run backup
```

Each file is encrypted with AES-256-GCM and a new nonce. A snapshot contains application tables, referenced Auth users/identities, referenced private assets and previews, migration source files, environment settings without the backup key, both local PostgreSQL dumps and n8n's local files. It does not contain the source repository, npm dependencies, unrelated Supabase tables, platform configuration or active Auth sessions. Database snapshots are individually consistent; the services are not paused for a global snapshot.

Before marking a backup verified, the tool restores both PostgreSQL dumps into a disposable container with no network, loads the application snapshot into isolated embedded PostgreSQL, checks relationship consistency and asset coverage, and verifies file hashes and authentication tags. Only verified snapshots participate in automatic retention. Failed/incomplete encrypted directories remain for diagnosis. Verification never restores over the live project.

Recheck an archive:

```powershell
npm.cmd run backup:verify -- "C:\Users\Grail\Desktop\GrailHiiv\backups\YOUR_BACKUP_DIRECTORY"
```

Register the daily Windows task:

```powershell
./scripts/register-backup.ps1
Get-ScheduledTask -TaskName 'GrailHiiv Local Backup'
```

It runs at **02:00 in the Windows machine's timezone** (this machine uses Taipei time), with a hidden window and no stored account password. It runs while the registering user is signed in, catches up after a missed start, and retries failures hourly up to three times. Docker Desktop and access to Supabase must be available. Task history and Settings show failures/results; no external alert service is added.

For real recovery, preserve the key, use the matching application/migrations, and restore into an isolated environment first. Restore Auth data and Supabase platform configuration using the appropriate administrative recovery procedure. Reconcile queued/running jobs before restarting workers to avoid replaying an uncertain operation. Local backups protect against application mistakes; losing the machine or disk can also lose archives stored on it.

## Deployment

Apply `20261011041605_internal_operations.sql` once after the existing migrations, then rebuild/recreate the app, AI worker, automation worker and new internal worker:

```powershell
docker compose --env-file .env --profile ai config --quiet
docker compose --env-file .env --profile ai up -d --build
```

Checks include SQL permission/quota/concurrency tests in embedded PostgreSQL, real SDK request/usage tests with mock provider responses, encryption/tampering and isolated restore tests, browser tests of editing/regeneration/settings, and real authenticated Supabase/Storage smoke tests. No validation call sends invitation/recovery emails, publishes a post or sends a paid content-generation request.
