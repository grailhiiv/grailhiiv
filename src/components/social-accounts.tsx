"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { cloudRequest } from "@/lib/cloud";
import { useWorkspace } from "./workspace-provider";
import { Badge, Field, Modal } from "./ui";
type Connection = { id: string; client_id: string; platform: string; account_name: string; account_id: string; enabled: boolean };
type Job = { id: string; client_id: string; post_id: string; snapshot: { title: string; platform: string }; state: string; detail: string; provider_id: string | null; due_at: string };
type Status = { configured: boolean; workerAvailable: boolean; redirectUri: string; connections: Connection[]; jobs: Job[]; pendingClientId?: string; pending: { id: string; name: string; instagram: boolean }[] };
const deliveryMessage: Record<string, string> = {
  reconnect_required: "The account token expired or was revoked. Reconnect this account.",
  permission_required: "Meta did not grant publishing access. Check app permissions and reconnect.",
  instagram_image_required: "Instagram needs an approved, uploaded JPEG image.",
  instagram_image_requirements: "Instagram needs a JPEG under 8 MB, with an aspect ratio between 4:5 and 1.91:1.",
  image_format_unsupported: "Use an uploaded JPEG or PNG. Instagram requires JPEG.",
  image_required: "This release supports single-image posts. Video and PDF publishing are unavailable.",
  instagram_caption_too_long: "Shorten the Instagram caption to 2,200 characters and submit it for approval again.",
  delivery_unknown: "The request ended without a confirmed result. Check the platform before retrying.",
  receipt_not_saved: "Meta confirmed delivery, but its receipt could not be saved. Check the platform.",
  provider_rejected: "Meta rejected the post. Check the account and media requirements before retrying.",
  media_invalid: "Meta could not process the image. Check its format and reconnect if needed.",
};
export function SocialAccounts() {
  const { data, session, refresh, toast, clientId: activeClientId } = useWorkspace();
  const wid = session?.workspaceId, owner = session?.role === "owner";
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [client, setClient] = useState(data.clients.find(c => c.id === activeClientId)?.id || data.clients[0]?.id || ""), [pageId, setPageId] = useState(""), [platform, setPlatform] = useState("Facebook");
  const [confirm, setConfirm] = useState<{ account?: Connection; job?: Job } | null>(null);
  const [receipt, setReceipt] = useState("");
  const [setup, setSetup] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!wid || !owner) return;
    try {
      const response = await fetch("/api/social?workspaceId=" + wid, { cache: "no-store", signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Publishing status unavailable.");
      setStatus(result); setError("");
    } catch (e) { if (!signal?.aborted) setError((e as Error).message); }
  }, [wid, owner]);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("platform");
    if (requested === "Instagram") setPlatform(requested);
    const controller = new AbortController(); void load(controller.signal);
    const timer = setInterval(() => { if (!document.hidden) void load(controller.signal); }, 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [load]);
  async function action(body: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const result = await cloudRequest<{ url?: string }>("/api/social", { workspaceId: wid, ...body });
      if (result.url) { window.location.assign(result.url); return; }
      setConfirm(null); await load(); await refresh();
    } catch (e) { setError((e as Error).message); toast((e as Error).message); }
    finally { setBusy(false); }
  }
  function connect(platform: string) {
    setPlatform(platform);
    if (!status?.configured) { setSetup(true); return; }
    void action({ action: "connect", clientId: client, platform });
  }
  if (!owner) return <section className="panel settings-form"><h2>Social Publishing</h2><p>An owner can connect Facebook and Instagram accounts and review deliveries. Approved posts publish at their scheduled time when publishing is enabled.</p></section>;
  const chosen = status?.pending.find(p => p.id === pageId);
  return <section className="panel settings-form social-settings">
    <h2>Connected Accounts</h2>
    <div className="social-account"><strong>Supabase</strong><Badge>Connected</Badge></div>
    <div className="social-account"><strong>n8n</strong><Link className="button" href="/automations">Manage Automations</Link></div>
    <div className="social-heading">
      <h3>Facebook and Instagram</h3>
      <p className="muted">Choose a client, then connect their social accounts below.</p>
    </div>
    {!status && !error && <p role="status">Loading publishing settings…</p>}
    {!status && error && <button className="button" onClick={() => void load()}>Reload Accounts</button>}
    {status && <>
      <div className="social-connect">
        <Field label="Connect Accounts For"><select required value={client} onChange={e => setClient(e.target.value)}><option value="">Choose a client</option>{data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      </div>
      {["Facebook", "Instagram"].map(name => <div className="social-account" key={name}><div><strong>{name}</strong><p className="muted">{name === "Instagram" ? "Professional account linked to your Facebook Page" : "Publish to a Facebook Page"}</p></div><button className="button primary" disabled={busy || !client} onClick={() => connect(name)}>Connect {name}</button></div>)}
      <div className="social-account"><strong>LinkedIn</strong><Badge>Coming Later</Badge></div>
      <div className="social-account"><strong>CRM</strong><Badge>Coming Later</Badge></div>
      {status.pending.length > 0 && <form className="detail-section" onSubmit={e => { e.preventDefault(); void action({ action: "choose", pageId, platform }); }}>
        <h3>Choose an Authorized Account</h3><p>Connect accounts for <strong>{data.clients.find(c => c.id === (status.pendingClientId || client))?.name}</strong>. Save Facebook and Instagram separately. New connections are paused until you enable publishing.</p>
        <Field label="Facebook Page"><select required value={pageId} onChange={e => setPageId(e.target.value)}><option value="">Choose a Page</option>{status.pending.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Publishing Platform"><select value={platform} onChange={e => setPlatform(e.target.value)}><option>Facebook</option><option disabled={!chosen?.instagram}>Instagram</option></select></Field>
        {!chosen?.instagram && pageId && <p className="muted">Link a professional Instagram account to this Page to connect Instagram.</p>}
        <button className="button" disabled={busy || !pageId || (platform === "Instagram" && !chosen?.instagram)}>Save Account</button>
      </form>}
      <div className="detail-section"><h3>Client Accounts</h3>
        {!status.connections.length && <p className="muted">No social accounts connected.</p>}
        {status.connections.map(c => <div className="social-account" key={c.id}>
          <div><strong>{c.platform} · {c.account_name}</strong><p>{data.clients.find(client => client.id === c.client_id)?.name} · <Badge>{c.enabled ? "Publishing Enabled" : "Paused"}</Badge></p></div>
          <div className="social-actions"><button className="button" disabled={busy} onClick={() => c.enabled ? void action({ action: "account", connectionId: c.id, operation: "disable" }) : setConfirm({ account: c })}>{c.enabled ? "Pause Publishing" : "Enable Publishing"}</button><button className="button" disabled={busy} onClick={() => void action({ action: "account", connectionId: c.id, operation: "disconnect" })}>Disconnect</button></div>
        </div>)}
      </div>
      <div className="detail-section"><h3>Publishing History</h3><p className="muted">Times use each client’s timezone. Delivery errors leave the content scheduled; only a confirmed receipt marks it published.</p>
        {!status.jobs.length && <p>No deliveries yet. Enable an account and schedule an approved post.</p>}
        {status.jobs.map(j => <article className="social-job" key={j.id}>
          <div><strong>{j.snapshot.title}</strong><p>{j.snapshot.platform} · {data.clients.find(c => c.id === j.client_id)?.name}</p><Badge>{j.state}</Badge><p><time dateTime={j.due_at}>{new Date(j.due_at).toLocaleString(undefined, { timeZone: data.clients.find(c => c.id === j.client_id)?.timezone || "UTC" })}</time></p>
          {j.detail && <p>{deliveryMessage[j.detail] || j.detail}</p>}{j.provider_id && <p>Receipt: {j.snapshot.platform === "Facebook" ? <a href={`https://www.facebook.com/${j.provider_id}`} target="_blank" rel="noreferrer">{j.provider_id}</a> : j.provider_id}</p>}</div>
          <div className="social-actions">{["Failed","Cancelled"].includes(j.state) && <button className="button" disabled={busy} onClick={() => void action({ action: "job", jobId: j.id, operation: "retry" })}>Retry Delivery</button>}
          {j.state === "Needs review" && <button className="button" disabled={busy} onClick={() => setConfirm({ job: j })}>Review Uncertain Delivery</button>}
          {["Queued", "Preparing", "Failed"].includes(j.state) && <button className="button" disabled={busy} onClick={() => void action({ action: "job", jobId: j.id, operation: "cancel" })}>Cancel Delivery</button>}</div>
        </article>)}
      </div>
    </>}
    {confirm && <Modal title={confirm.account ? "Enable Scheduled Publishing" : "Review Uncertain Delivery"} onClose={() => { if (!busy) setConfirm(null); }}>
      {confirm.account ? <p>Approved {confirm.account.platform} posts for {data.clients.find(c => c.id === confirm.account!.client_id)?.name} will publish automatically to {confirm.account.account_name} at their scheduled time. Posts more than ten minutes overdue are skipped. Drafts and posts awaiting approval remain unsent.</p> : <p>Check this post on the connected platform first. Meta may have published it even though the request timed out. Retry only after confirming it was not published; retrying an existing post can create a duplicate.</p>}
      {error && <p role="alert">{error}</p>}
      {confirm.job && <form onSubmit={e => { e.preventDefault(); void action({ action: "receipt", jobId: confirm.job!.id, providerId: receipt }); }}><Field label="Existing Platform Post ID"><input required pattern="[0-9_]+" maxLength={100} value={receipt} onChange={e => setReceipt(e.target.value)} /></Field><button className="button" disabled={busy || !receipt}>Verify Published Receipt</button></form>}
      {confirm.job && <button className="button" disabled={busy} onClick={() => void action({ action: "job", jobId: confirm.job!.id, operation: "dismiss_uncertain" })}>Confirmed Not Published — Cancel</button>}
      <div className="modal-footer"><button className="button" disabled={busy} onClick={() => setConfirm(null)}>Close</button><button className="button primary" disabled={busy} onClick={() => void action(confirm.account ? { action: "account", connectionId: confirm.account.id, operation: "enable" } : { action: "job", jobId: confirm.job!.id, operation: "retry_uncertain" })}>{confirm.account ? "Enable Scheduled Publishing" : "Confirmed Not Published — Retry"}</button></div>
    </Modal>}
    {setup && <Modal title="Set Up Meta Connection" onClose={() => setSetup(false)}><p>The server needs a registered Meta app before it can open account authorization. Add its app ID and app secret to the environment and restart the app and social worker. Your social encryption key has already been generated by local setup.</p><p>Register this exact redirect URL in the Meta app’s Facebook Login settings:</p><p><code>{status?.redirectUri}</code></p><p>After setup, Connect {platform} will open Meta’s login and permission screen. Instagram requires a professional account linked to a Facebook Page.</p><div className="modal-footer"><button className="button" onClick={() => setSetup(false)}>Close</button></div></Modal>}
  </section>;
}
