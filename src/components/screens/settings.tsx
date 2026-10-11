"use client";
import { useEffect, useState } from "react";
import {
  Plus,
  Save,
  Download,
  ShieldCheck,
  Unplug,
  Upload,
} from "lucide-react";
import { useWorkspace } from "../workspace-provider";
import { Badge, ClientMark, Field, Modal } from "../ui";
import { downloadFile } from "@/lib/assets";
import type { Client } from "@/lib/types";
import { TeamSettings } from "../team-settings";
import { titleLabel } from "@/lib/labels";
import { OperationsSettings } from "../operations-settings";
import { SocialAccounts } from "../social-accounts";
export function SettingsScreen() {
  const { data, clientId, update, toast, cloud, session } = useWorkspace();
  const [tab, setTab] = useState(data.clients.length ? "Clients" : "Workspace");
  useEffect(() => { if (new URLSearchParams(window.location.search).has("social")) setTab("Connected accounts"); }, []);
  const [selectedId, setSelectedId] = useState(
    clientId === "all" ? data.clients[0]?.id || "" : clientId,
  );
  const [adding, setAdding] = useState(false);
  const [workspaceName, setWorkspaceName] = useState(data.preferences.name);
  const selected =
    data.clients.find((c) => c.id === selectedId) || data.clients[0];
  const canManage = !cloud || session?.role === "owner";
  return (
    <>
      <div className="settings-tabs">
        {[
          "Workspace",
          "Clients",
          "Team & permissions",
          "Connected accounts",
          "AI preferences",
          "Notifications",
        ].map((t) => (
          <button
            className={tab === t ? "selected" : ""}
            aria-pressed={tab === t}
            key={t}
            onClick={() => setTab(t)}
          >
            {titleLabel(t)}
          </button>
        ))}
      </div>
      {tab === "Clients" && (
        <div className="settings-layout">
          <aside className="panel client-list">
            {data.clients.map((c) => (
              <button
                key={c.id}
                className={selected?.id === c.id ? "selected" : ""}
                onClick={() => setSelectedId(c.id)}
              >
                <ClientMark client={c} />
                <span>
                  <strong>{c.name}</strong>
                  <small>{c.description || c.contact}</small>
                </span>
              </button>
            ))}
            <button
              className="add-client"
              disabled={cloud && session?.role !== "owner"}
              onClick={() => setAdding(true)}
            >
              <Plus size={17} />
              Add Client
            </button>
          </aside>
          {selected ? (
            <ClientSettings key={selected.id} client={selected} />
          ) : (
            <section className="panel settings-form">
              <h2>No Clients Yet</h2>
              <p>Add a client to manage its preferences.</p>
            </section>
          )}
        </div>
      )}
      {tab === "Workspace" && (
        <section className="panel settings-form">
          <h2>Workspace Preferences</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!workspaceName.trim()) return;
              update((prev) => ({
                ...prev,
                preferences: {
                  ...prev.preferences,
                  name: workspaceName.trim(),
                },
              }));
              toast("Workspace preferences saved");
            }}
          >
            <fieldset className="settings-fields" disabled={!canManage}>
            <Field label="Workspace Name">
              <input
                required
                maxLength={80}
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
              />
            </Field>
            <div className="modal-footer">
              <button className="button primary">
                <Save size={16} />
                Save Changes
              </button>
            </div>
            </fieldset>
          </form>
          <div className="detail-section">
            <h3>Export Workspace</h3>
            <p className="muted">
              Download your client settings, content, leads, workflows and
              activity as JSON. Uploaded file binaries are not included;
              download those from the Asset Library.
            </p>
            <button
              className="button"
              onClick={() => {
                downloadFile(
                  JSON.stringify(data, null, 2),
                  "grailhiiv-workspace.json",
                  "application/json",
                );
                toast("Workspace exported");
              }}
            >
              <Download size={16} />
              Export Workspace
            </button>
          </div>
        </section>
      )}
      {tab === "Team & permissions" && cloud && <TeamSettings />}
      {tab === "Team & permissions" && !cloud && (
        <section className="panel settings-form">
          <h2>
            <ShieldCheck size={20} />
            Team Access
          </h2>
          <div className="team-row">
            <span className="avatar">SL</span>
            <div>
              <strong>Sam Lee</strong>

            </div>
            <Badge tone="green">Owner</Badge>
          </div>
          <div className="integration-banner">
            <Unplug size={22} />
            <p>
              Connect a shared workspace to invite teammates and assign client access.
            </p>
          </div>
        </section>
      )}
      {tab === "Connected accounts" && cloud && <SocialAccounts key={session?.workspaceId} />}
      {tab === "Connected accounts" && !cloud && (
        <section className="panel settings-form">
          <h2>Connected Accounts</h2>
          <p className="muted">
            {cloud
              ? "Supabase is connected. Manage n8n workflows and service status on the Automations screen. Social accounts are not connected yet."
              : "No external accounts are connected in this local demo."}
          </p>
          {["Supabase", "n8n", "Instagram", "Facebook", "LinkedIn", "CRM"].map(
            (name) => (
              <div className="connection-row" key={name}>
                <span className="connection-icon">
                  <Unplug size={18} />
                </span>
                <strong>{name}</strong>
                <Badge>
                  {name === "Supabase" && cloud
                    ? "Connected"
                    : name === "n8n" && cloud
                      ? "See Automations"
                      : "Not connected"}
                </Badge>
              </div>
            ),
          )}
</section>
      )}
      {tab === "AI preferences" && cloud && <OperationsSettings key={session?.workspaceId} />}
      {tab === "AI preferences" && !cloud && (
        <section className="panel settings-form">
          <h2>AI Preferences</h2>
          <p className="muted">
            The demo uses editable content templates. In a shared workspace,
            you can choose an AI model when creating a content plan.
          </p>
          <p>
            Describe how your client should sound and who they are writing
            for in the Clients tab.
          </p>
        </section>
      )}
      {tab === "Notifications" && (
        <section className="panel settings-form">
          <h2>Workspace Notifications</h2>
          <div className="preference-row">
            <div>
              <strong>Show activity indicator</strong>
              <p className="muted small-text">
                Display the notification dot next to recent activity.
              </p>
            </div>
            <button
              className={
                "toggle " + (data.preferences.notifications ? "on" : "")
              }
              role="switch"
              aria-label="Show Activity Indicator"
              aria-checked={data.preferences.notifications}
              onClick={() => {
                update((prev) => ({
                  ...prev,
                  preferences: {
                    ...prev.preferences,
                    notifications: !prev.preferences.notifications,
                  },
                }));
                toast("Notification preference saved");
              }}
            >
              <span />
            </button>
          </div>
          <p className="muted small-text">
            Email and push notifications are not available.
          </p>
        </section>
      )}
      {adding && (
        <NewClient
          onClose={() => setAdding(false)}
          onCreated={(id) => setSelectedId(id)}
        />
      )}
    </>
  );
}
function ClientSettings({ client }: { client: Client }) {
  const { update, toast, activity, cloud, session, refresh } = useWorkspace();
  const [form, setForm] = useState(client);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    update((prev) => ({
      ...prev,
      clients: prev.clients.map((c) =>
        c.id === client.id ? { ...form, name: form.name.trim() } : c,
      ),
    }));
    activity("Client preferences updated", client.id);
    toast("Client settings saved");
  }
  return (
    <section className="panel settings-form">
      <form onSubmit={submit}>
        <fieldset className="settings-fields" disabled={cloud && session?.role !== "owner"}>
        <div className="settings-client-heading">
          <ClientMark client={form} />
          <div>
            <h2>{client.name}</h2>
            <small className="muted">PNG or JPG, up to 1 MB</small>
            <div className="logo-actions">
              <label className="button">
                <Upload size={17} />
                Change Logo
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="visually-hidden"
                  aria-label="Change Client Logo"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 1024 * 1024) {
                      toast("Choose a logo under 1 MB.");
                      return;
                    }
                    if (cloud) {
                      try {
                        if (session?.role !== "owner")
                          throw new Error(
                            "Only owners can change client logos.",
                          );
                        const body = new FormData();
                        body.set("workspaceId", session.workspaceId);
                        body.set("clientId", client.id);
                        body.set("file", file);
                        const response = await fetch("/api/assets", {
                          method: "POST",
                          body,
                        });
                        const result = await response.json();
                        if (!response.ok) throw new Error(result.error);
                        setForm((previous) => ({
                          ...previous,
                          logo: result.asset.url,
                        }));
                        await refresh();
                        toast(
                          "Logo uploaded. Save client settings to apply it.",
                        );
                      } catch (error) {
                        toast((error as Error).message);
                      }
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () =>
                      setForm({ ...form, logo: String(reader.result) });
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              <button
                type="button"
                className="button"
                onClick={() => setForm({ ...form, logo: "" })}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
        <div className="form-grid">
          <Field label="Client Name">
            <input
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Website">
            <input
              type="url"
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
            />
          </Field>
          <Field label="Timezone">
            <select
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            >
              {[
                form.timezone,
                "Asia/Taipei",
                "Asia/Singapore",
                "Asia/Manila",
                "America/New_York",
                "America/Los_Angeles",
                "Europe/London",
                "Australia/Sydney",
                "UTC",
              ].filter((t, i, options) => options.indexOf(t) === i).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Main Contact Name">
            <input
              value={form.contact}
              onChange={(e) => setForm({ ...form, contact: e.target.value })}
            />
          </Field>
          <Field label="Main Contact Email">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Brand Voice">
            <textarea
              rows={3}
              value={form.voice}
              onChange={(e) => setForm({ ...form, voice: e.target.value })}
            />
          </Field>
          <Field label="Target Audience">
            <textarea
              rows={3}
              value={form.audience}
              onChange={(e) => setForm({ ...form, audience: e.target.value })}
            />
          </Field>
        </div>
        <div className="preference-row">
          <div>
            <strong>Require approval before publishing</strong>
          </div>
          <button
            type="button"
            className={"toggle " + (form.approvalRequired ? "on" : "")}
            role="switch"
            aria-label="Require Approval Before Publishing"
            aria-checked={form.approvalRequired}
            onClick={() =>
              setForm({ ...form, approvalRequired: !form.approvalRequired })
            }
          >
            <span />
          </button>
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="button"
            onClick={() => setForm(client)}
          >
            Discard Changes
          </button>
          <button className="button primary">Save Changes</button>
        </div>
        </fieldset>
      </form>
    </section>
  );
}
function NewClient({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { update, toast } = useWorkspace();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  return (
    <Modal title="Add a Client" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const id = crypto.randomUUID();
          const client: Client = {
            id,
            name: name.trim(),
            initials: name
              .trim()
              .split(/\s+/)
              .map((s) => s[0])
              .join("")
              .slice(0, 2)
              .toUpperCase(),
            color: "#e2eee9",
            contact,
            email,
            website: "",
            timezone: "Asia/Singapore",
            voice: "",
            audience: "",
            approvalRequired: true,
          };
          update((prev) => ({ ...prev, clients: [...prev.clients, client] }));
          onCreated(id);
          toast("Client added");
          onClose();
        }}
      >
        <Field label="Client Name">
          <input
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Main Contact">
          <input value={contact} onChange={(e) => setContact(e.target.value)} />
        </Field>
        <Field label="Contact Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <div className="modal-footer">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary">
            <Plus size={16} />
            Add Client
          </button>
        </div>
      </form>
    </Modal>
  );
}
