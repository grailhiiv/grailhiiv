# Facebook and Instagram publishing

Owners connect accounts in **Settings → Connected Accounts**. **Connect Facebook** and **Connect Instagram** open Meta authorization when the server app is configured. Until then the buttons open setup instructions. LinkedIn and CRM integrations remain unavailable.

## Server setup

Create a Meta developer app with Facebook Login and the Pages/Instagram publishing use cases. Register the **exact callback URL shown in Connected Accounts** in its valid OAuth redirect URIs. Use a public HTTPS application URL for deployment; use a loopback development callback only if Meta accepts it for your app. The browser must use the same hostname as `GRAILHIIV_SITE_URL`, so its secure authorization cookie reaches the callback.

Set these in the existing `.env`, retaining all other settings:

```dotenv
GRAILHIIV_META_APP_ID=your_numeric_app_id
GRAILHIIV_META_APP_SECRET=your_app_secret
GRAILHIIV_META_API_VERSION=v25.0
GRAILHIIV_SOCIAL_ENCRYPTION_KEY=your_existing_generated_64_character_hex_key
```

`npm run setup:selfhost` generates only a missing encryption key. Keep the key: changing it prevents decryption of existing connections. Do not place the secret or encryption key in `NEXT_PUBLIC_` variables. Apply `supabase/migrations/20261011065141_social_publishing.sql` and `supabase/migrations/20261011071311_social_publishing_asset_guard.sql` to an installed database after their preceding migrations, then:

```powershell
docker compose --env-file .env build app social-worker
docker compose --env-file .env up -d --no-deps app social-worker
```

For native development, run `npm run worker:social` alongside the application. Worker health means configuration and queue access are available; account authorization and successful delivery are separate checks.

Authorize `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, and `instagram_content_publish`. You need publishing access to the selected Facebook Page. Instagram must be a professional account linked to that Page. Meta app review/access levels and any business verification Meta requires must be completed before connecting accounts outside app roles/test accounts. App credentials and permissions cannot be supplied by GrailHiiv automatically.

Reference: [Meta's Instagram collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), [Facebook Login](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/), [Pages publishing](https://developers.facebook.com/docs/pages-api/posts/).

## Connect and send

1. Select the client, click its platform's Connect button, and grant Meta's permissions.
2. Choose an authorized Facebook Page. Save Facebook and/or its linked Instagram account separately. Connections start paused.
3. Click **Enable Publishing** and review the destination before enabling automatic sends. Only approved scheduled content can be sent. Newly enabled accounts skip posts more than ten minutes overdue; resubmit those with a new future schedule.
4. Submit a dated post for approval. Approval binds its caption, platform, schedule, and asset choice. The worker queues it and publishes in the client's configured timezone, typically within ten seconds of its scheduled time while running.
5. Check Publishing History. A provider receipt marks the content **Published**, with an activity entry; refreshing the calendar loads that status.

Facebook supports text and one uploaded JPEG/PNG image. Instagram supports one uploaded JPEG under 8 MB with aspect ratio 4:5 through 1.91:1, and captions up to 2,200 characters. The linked asset must be approved. Demo media, videos, PDFs, carousels, Stories and Reels are not published by this release. Originals are validated and shared using a temporary HTTPS Supabase Storage URL; thumbnails are not published. Meta also validates its own media/account limits.

## Delivery recovery

The worker checks current workspace membership, approval content, destination, client timezone and asset snapshot before entering **Sending**. Delivery-affecting record edits are blocked during Sending and unresolved uncertain delivery. Feedback/metrics do not change the approved delivery content. Editing before Sending cancels the old job; the changed content needs a new approval.

Jobs are leased atomically. Provider rejections are **Failed** and require an owner to retry. An Instagram container still processing is safely polled using its saved ID. A timeout, crash, or unsaved successful receipt becomes **Needs review**. Sending is never automatically retried after a lease expires, because Meta might already have accepted the post.

For an uncertain result, check the platform. Enter its post ID under **Verify Published Receipt** to verify ownership and caption before recording success. If you have confirmed no post exists, explicitly choose **Confirmed Not Published — Retry**, or **Confirmed Not Published — Cancel**. Retry can duplicate a post if the manual check was wrong. Revoked access or changed approval still blocks retry. Resolve uncertain jobs before replacing/disconnecting the destination.

Pausing cancels queued/preparing jobs. Cancelled jobs need an explicit retry or a new approval. Known expired/revoked tokens require reconnecting. Credentials are encrypted with client/platform-bound AES-GCM and have no browser-readable table access. Disconnect removes the local credential; it does not revoke the whole Meta app's access to other client accounts.

Encrypted backups include connections and delivery receipts as well as the encryption key in the encrypted environment snapshot. Transient OAuth state is deliberately excluded. Old pre-publishing backups remain readable but do not contain these new tables.

Local tests mock Meta and publish nothing externally. Live authorization and delivery must be tested after supplying the Meta app credentials and connecting a test Page/account.
