"use client";
import { useEffect, useId, useState, type ReactNode } from "react";
import { cloudRequest } from "@/lib/cloud";
import { defaultLimits, type OperationsData, type InternalRule } from "@/lib/operations";
import { useWorkspace } from "./workspace-provider";
import { Field } from "./ui";

const emptyRule = {
  name: "", client_id: "", event: "lead_created" as const, action: "followup" as const,
  message: "Follow up with this lead", interval_minutes: 60, due_days: 3, enabled: false,
};
const serviceNames: Record<string, string> = {
  ai: "AI Content Assistant", n8n: "Connected Workflows", internal: "Automatic Workspace Actions",
  social: "Social Publishing", backup: "Backups",
};
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
function dateLabel(value?: string) {
  return value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "Date unavailable";
}
function ExplainedField({ label, help, children }: {
  label: string; help: string; children: (descriptionId: string) => ReactNode;
}) {
  const id = useId();
  return <div className="settings-control"><Field label={label}>{children(id)}</Field><p className="field-help" id={id}>{help}</p></div>;
}
export function OperationsSettings() {
  const { session, data } = useWorkspace();
  const [remote, setRemote] = useState<OperationsData | null>(null);
  const [limits, setLimits] = useState(defaultLimits);
  const [rule, setRule] = useState<Omit<InternalRule, "id">>({ ...emptyRule, client_id: data.clients[0]?.id || "" });
  const [ruleId, setRuleId] = useState<string | null>(null);
  const [error, setError] = useState(""), [loadError, setLoadError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const wid = session?.workspaceId;
  useEffect(() => {
    if (!wid || session?.role !== "owner") return;
    let disposed = false, first = true;
    const load = async () => {
      try {
        const result = await cloudRequest<OperationsData>("/api/operations?workspaceId=" + wid);
        if (!disposed) {
          setRemote(result); setLoadError("");
          if (first) { setLimits(result.settings); first = false; }
        }
      } catch (e) { if (!disposed) setLoadError((e as Error).message); }
    };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => { disposed = true; clearInterval(timer); };
  }, [wid, session?.role, reloadKey]);
  if (session?.role !== "owner") return <section className="panel settings-form"><h2>AI Preferences</h2><p>Your workspace owner manages AI spending limits and automatic actions.</p></section>;

  async function save(body: unknown, message: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      await cloudRequest("/api/operations", body);
      setNotice(message);
      try { setRemote(await cloudRequest<OperationsData>("/api/operations?workspaceId=" + wid)); setLoadError(""); }
      catch { setLoadError("Your changes were saved, but the latest status could not load. It will refresh automatically."); }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const tokens = remote?.totals?.tokens ?? remote?.usage.reduce((n, r) => n + (r.input_tokens === null ? 0 : r.input_tokens + (r.output_tokens || 0)), 0) ?? 0;
  const reserved = remote?.totals?.reserved ?? remote?.usage.reduce((n, r) => n + (r.input_tokens === null ? r.reserved_tokens : 0), 0) ?? 0;
  const estimated = Number(remote?.totals?.cost ?? remote?.usage.reduce((n, r) => n + Number(r.estimated_cost || 0), 0) ?? 0);
  const unpriced = remote?.totals?.unpriced ?? remote?.usage.filter(r => r.input_tokens !== null && r.estimated_cost === null).length ?? 0;
  const reset = new Date(); reset.setUTCHours(24, 0, 0, 0);
  const resetLabel = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(reset);
  return <section className="panel settings-form operations-settings">
    <h2>AI Preferences</h2>
    <p className="muted">Control AI spending and usage for your workspace. The extra settings below explain what each option does.</p>
    {error && <p role="alert">{error}</p>}
    {loadError && <div className="settings-feedback"><p role="alert">{loadError}</p><button className="button" disabled={busy} onClick={() => setReloadKey(k => k + 1)}>Reload Settings</button></div>}
    {notice && <p role="status">{notice}</p>}
    {!remote && !loadError && <p role="status">Loading your AI preferences…</p>}
    <div className="ai-usage-summary">
      <span>Estimated AI Cost Today</span>
      <strong>{!remote ? "—" : unpriced ? "Cost unavailable" : estimated > 0 && estimated < 0.01 ? "Less than $0.01" : money.format(estimated)}</strong>
      <p className="muted">{unpriced ? "Some model prices are missing, so the full cost cannot be estimated yet." : "Based on reported usage. Pending requests may add to this amount."}</p>
      <small>Daily limits reset at {resetLabel}.</small>
    </div>
    <form onInvalid={e => { const details = (e.target as HTMLElement).closest("details"); if (details) details.open = true; }} onSubmit={e => { e.preventDefault(); void save({ action: "limits", workspaceId: wid, settings: limits }, "AI preferences saved."); }}>
      <fieldset className="settings-fields" disabled={busy || !remote}>
        <ExplainedField label="Daily Spending Limit (USD)" help="The maximum estimated AI cost per day. Enter 0 for no spending limit.">
          {id => <input name="dailyBudget" aria-describedby={id} type="number" required min={0} max={10000} step="any" value={limits.daily_ai_budget} onChange={e => setLimits({ ...limits, daily_ai_budget: Number(e.target.value) })} />}
        </ExplainedField>
        <details className="settings-disclosure">
          <summary>Advanced AI and Storage Settings</summary>
          <p className="muted">These limits help control usage and storage. You can keep the existing values if you are unsure.</p>
          <div className="form-grid">
            <ExplainedField label="AI Requests per Hour" help="How many times AI can be called in one hour. Generating content or regenerating a caption uses a request.">
              {id => <input name="hourlyRequests" aria-describedby={id} type="number" required min={1} max={200} value={limits.hourly_ai_calls} onChange={e => setLimits({ ...limits, hourly_ai_calls: Number(e.target.value) })} />}
            </ExplainedField>
            <ExplainedField label="Daily Text Allowance (Tokens)" help="Tokens are the units AI uses to measure text. This limit covers text it reads and writes, including allowance held for pending requests.">
              {id => <input name="dailyTokens" aria-describedby={id} type="number" required min={1000} max={10000000} value={limits.daily_ai_tokens} onChange={e => setLimits({ ...limits, daily_ai_tokens: Number(e.target.value) })} />}
            </ExplainedField>
            <ExplainedField label="AI Reasoning Level" help="How deeply supported OpenAI models consider your request. Model Default follows the setting chosen for each model.">
              {id => <select name="reasoning" aria-describedby={id} value={limits.reasoning_effort} onChange={e => setLimits({ ...limits, reasoning_effort: e.target.value as typeof limits.reasoning_effort })}>{[["default", "Model Default"], ["none", "Off"], ["low", "Low"], ["medium", "Medium"], ["high", "High"], ["xhigh", "Very High"], ["max", "Maximum"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
            </ExplainedField>
            <ExplainedField label="File Storage Limit (MB)" help="The space available for uploaded files and their preview images. Current usage is shown below.">
              {id => <input name="storageLimit" aria-describedby={id} type="number" required min={10} max={102400} step="any" value={limits.asset_quota_bytes / 1048576} onChange={e => setLimits({ ...limits, asset_quota_bytes: Math.round(Number(e.target.value) * 1048576) })} />}
            </ExplainedField>
            <ExplainedField label="Keep AI Recovery Data (Days)" help="How long to keep data that helps recover interrupted AI jobs. This does not delete your saved posts.">
              {id => <input name="recoveryDays" aria-describedby={id} type="number" required min={1} max={365} value={limits.checkpoint_days} onChange={e => setLimits({ ...limits, checkpoint_days: Number(e.target.value) })} />}
            </ExplainedField>
          </div>
          <div className="ai-usage-details">
            <p><strong>Files stored:</strong> {((remote?.assetsBytes || 0) / 1048576).toFixed(1)} MB</p>
            <p><strong>AI text processed today:</strong> {tokens.toLocaleString()} tokens</p>
            <p><strong>Allowance awaiting confirmation:</strong> {reserved.toLocaleString()} tokens</p>
            <p className="muted">Pending requests keep their allowance until usage is confirmed. Cost estimates use the prices configured for each AI model.</p>
          </div>
        </details>
        <div className="modal-footer"><button className="button primary" disabled={busy || !remote}>{busy ? "Saving…" : "Save AI Preferences"}</button></div>
      </fieldset>
    </form>
    <details className="settings-disclosure">
      <summary>Service and Backup Status</summary>
      <p className="muted">Check whether background services are running and whether recent backups completed.</p>
      <h3>Background Services</h3>
      {remote?.workers.map(w => <div className="settings-status-row" key={w.name}><div><strong>{serviceNames[w.name] || w.name}</strong><small>Last checked: {dateLabel(w.last_seen)}</small></div><span>{w.available ? "Running" : "Needs Attention"}</span></div>)}
      {remote && !remote.workers.length && <p>No service status has been received yet.</p>}
      <h3>Recent Backups</h3>
      <p className="muted">A backup is a saved copy of your data that can be used for recovery.</p>
      {remote?.backups.map(b => <div className="settings-status-row" key={b.id}><div><strong>{b.status === "Success" ? "Backup Completed" : "Backup Needs Attention"}</strong><small>{dateLabel(b.created_at)}</small><p>{b.detail}</p></div></div>)}
      {remote && !remote.backups.length && <p>No backup has been recorded yet.</p>}
    </details>
    <details className="settings-disclosure">
      <summary>Automatic Workspace Actions</summary>
      <p className="muted">Automatically add activity notes or create lead follow-up tasks when something happens in your workspace.</p>
      <h3>{ruleId ? "Edit Action" : "Create an Action"}</h3>
      {!data.clients.length && <p>Add a client before creating an automatic action.</p>}
      <form onSubmit={e => { e.preventDefault(); void save({ action: "rule", workspaceId: wid, ruleId, rule }, "Automatic action saved."); }}>
        <fieldset className="settings-fields" disabled={busy || !remote || !data.clients.length}>
          <div className="form-grid">
            <ExplainedField label="Action Name" help="A short name so you can recognize this action later.">{id => <input name="actionName" aria-describedby={id} required maxLength={100} value={rule.name} onChange={e => setRule({ ...rule, name: e.target.value })} />}</ExplainedField>
            <ExplainedField label="Client" help="This action applies only to the selected client.">{id => <select name="actionClient" aria-describedby={id} value={rule.client_id} disabled={Boolean(ruleId)} onChange={e => setRule({ ...rule, client_id: e.target.value })}>{data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</ExplainedField>
            <ExplainedField label="When to Run" help="Choose the event that starts this action.">{id => <select name="actionEvent" aria-describedby={id} value={rule.event} onChange={e => setRule({ ...rule, event: e.target.value as InternalRule["event"], action: e.target.value === "lead_created" ? rule.action : "activity" })}><option value="lead_created">When a Lead Is Added</option><option value="post_approved">When a Post Is Approved</option><option value="schedule">On a Regular Schedule</option></select>}</ExplainedField>
            <ExplainedField label="What Should Happen" help="Create a follow-up task for a new lead, or add a note to your activity feed.">{id => <select name="actionType" aria-describedby={id} value={rule.action} onChange={e => setRule({ ...rule, action: e.target.value as InternalRule["action"] })}><option value="activity">Add an Activity Note</option>{rule.event === "lead_created" && <option value="followup">Create a Follow-Up Task</option>}</select>}</ExplainedField>
            {rule.event === "schedule" && <ExplainedField label="Repeat Every (Minutes)" help="How often this action should run. The minimum is 5 minutes.">{id => <input name="repeatMinutes" aria-describedby={id} type="number" required min={5} max={10080} value={rule.interval_minutes} onChange={e => setRule({ ...rule, interval_minutes: Number(e.target.value) })} />}</ExplainedField>}
            <ExplainedField label={rule.action === "followup" ? "Follow-Up Task" : "Activity Note"} help="The text that will appear in the task or activity feed.">{id => <input name="actionMessage" aria-describedby={id} required maxLength={500} value={rule.message} onChange={e => setRule({ ...rule, message: e.target.value })} />}</ExplainedField>
            {rule.action === "followup" && <ExplainedField label="Follow Up After (Days)" help="How many days after the new lead to make the task due. Enter 0 for the same day.">{id => <input name="followupDays" aria-describedby={id} type="number" required min={0} max={90} value={rule.due_days} onChange={e => setRule({ ...rule, due_days: Number(e.target.value) })} />}</ExplainedField>}
          </div>
          <label className="preference-row"><span>Turn On This Action</span><input name="actionEnabled" type="checkbox" checked={rule.enabled} onChange={e => setRule({ ...rule, enabled: e.target.checked })} /></label>
          <div className="modal-footer"><button className="button" type="button" onClick={() => { setRuleId(null); setRule({ ...emptyRule, client_id: data.clients[0]?.id || "" }); }}>New Action</button><button className="button primary" disabled={busy || !rule.client_id || !remote}>Save Action</button></div>
        </fieldset>
      </form>
      <h3>Saved Actions</h3>
      {remote?.rules.map(r => <div className="preference-row" key={r.id}><span>{r.name} · {r.enabled ? "On" : "Off"}</span><button className="button" disabled={busy} onClick={() => { setRuleId(r.id); setRule({ name: r.name, client_id: r.client_id, event: r.event, action: r.action, message: r.message, interval_minutes: r.interval_minutes, due_days: r.due_days, enabled: r.enabled }); }}>Edit Action</button></div>)}
      {remote && !remote.rules.length && <p>No automatic actions have been created yet.</p>}
      <h3>Recent Action Results</h3>
      {remote?.runs.map(r => <div className="detail-section" key={r.id}><strong>{r.status === "Failed" ? "Action Needs Attention" : r.status}</strong><p>{r.detail}</p>{r.status === "Failed" && r.attempts < 3 && <button className="button" disabled={busy} onClick={() => void save({ action: "retry", workspaceId: wid, runId: r.id }, "Action queued to try again.")}>Try Again</button>}</div>)}
      {remote && !remote.runs.length && <p>No actions have run yet.</p>}
    </details>
  </section>;
}
