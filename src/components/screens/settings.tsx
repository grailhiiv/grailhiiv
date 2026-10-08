"use client";
import { useState } from "react";
import {
  Building2,
  Plus,
  Save,
  Download,
  ShieldCheck,
  Unplug,
  Check,
  Upload,
} from "lucide-react";
import { useWorkspace } from "../workspace-provider";
import { Badge, ClientMark, Field, Modal, Platform } from "../ui";
import { downloadFile } from "@/lib/assets";
import type { Client } from "@/lib/types";
export function SettingsScreen() {
  const { data, clientId, update, toast } = useWorkspace();
  const [tab, setTab] = useState("Clients");
  const [selectedId, setSelectedId] = useState(
    clientId === "all" ? data.clients[0].id : clientId,
  );
  const [adding, setAdding] = useState(false);
  const [workspaceName, setWorkspaceName] = useState(data.preferences.name);
  const selected =
    data.clients.find((c) => c.id === selectedId) || data.clients[0];
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
            key={t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Clients" && (
        <div className="settings-layout">
          <aside className="panel client-list">
            {data.clients.map((c) => (
              <button
                key={c.id}
                className={selected.id === c.id ? "selected" : ""}
                onClick={() => setSelectedId(c.id)}
              >
                <ClientMark client={c} />
                <span>
                  <strong>{c.name}</strong>
                  <small>{c.description || c.contact}</small>
                </span>
              </button>
            ))}
            <button className="add-client" onClick={() => setAdding(true)}>
              <Plus size={17} />
              Add client
            </button>
          </aside>
          <ClientSettings key={selected.id} client={selected} />
        </div>
      )}
      {tab === "Workspace" && (
        <section className="panel settings-form">
          <h2>Workspace preferences</h2>
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
            <Field label="Workspace name">
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
                Save changes
              </button>
            </div>
          </form>
          <div className="detail-section">
            <h3>Export your local workspace</h3>
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
              Export workspace
            </button>
          </div>
        </section>
      )}
      {tab === "Team & permissions" && (
        <section className="panel settings-form">
          <h2>
            <ShieldCheck size={20} />
            Team access
          </h2>
          <div className="team-row">
            <span className="avatar">SL</span>
            <div>
              <strong>Sam Lee</strong>
              <small>Demo workspace owner</small>
            </div>
            <Badge tone="green">Owner</Badge>
          </div>
          <div className="integration-banner">
            <Unplug size={22} />
            <p>
              Team invitations and enforced client permissions will be available
              when Supabase authentication is connected.
            </p>
          </div>
        </section>
      )}
      {tab === "Connected accounts" && (
        <section className="panel settings-form">
          <h2>Connected accounts</h2>
          <p className="muted">
            No external accounts are connected in this local demo.
          </p>
          {["Supabase", "n8n", "Instagram", "Facebook", "LinkedIn", "CRM"].map(
            (name) => (
              <div className="connection-row" key={name}>
                <span className="connection-icon">
                  <Unplug size={18} />
                </span>
                <strong>{name}</strong>
                <Badge>Not connected</Badge>
              </div>
            ),
          )}
          <p className="muted small-text">
            Service credentials belong on the server. This demo does not collect
            or store API keys in the browser.
          </p>
        </section>
      )}
      {tab === "AI preferences" && (
        <section className="panel settings-form">
          <h2>
            <Unplug size={20} />
            AI provider setup
          </h2>
          <p className="muted">
            LangChain and LangGraph are planned for the agent integration phase.
            The Overview’s content plan currently uses editable templates.
          </p>
          <div className="connection-row">
            <strong>Model provider</strong>
            <Badge>Not connected</Badge>
          </div>
          <p>
            Client-specific brand voice and audience settings are already
            available in the Clients tab.
          </p>
        </section>
      )}
      {tab === "Notifications" && (
        <section className="panel settings-form">
          <h2>Workspace notifications</h2>
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
              aria-label="Show activity indicator"
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
            Email and push notifications will be connected later.
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
  const { update, toast, activity } = useWorkspace();
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
        <div className="settings-client-heading">
          <ClientMark client={form} />
          <div>
            <h2>{client.name}</h2>
            <p className="muted small-text">Logo</p>
            <small className="muted">JPG or PNG, at least 400 × 400 px</small>
            <div className="logo-actions">
              <label className="button">
                <Upload size={17} />
                Change logo
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="visually-hidden"
                  aria-label="Change client logo"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 1024 * 1024) {
                      toast("Choose a logo under 1 MB.");
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
          <Field label="Client name">
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
                "Asia/Singapore",
                "Asia/Manila",
                "America/New_York",
                "America/Los_Angeles",
                "Europe/London",
                "Australia/Sydney",
                "UTC",
              ].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Main contact name">
            <input
              value={form.contact}
              onChange={(e) => setForm({ ...form, contact: e.target.value })}
            />
          </Field>
          <Field label="Main contact email">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Brand voice">
            <textarea
              rows={3}
              value={form.voice}
              onChange={(e) => setForm({ ...form, voice: e.target.value })}
            />
          </Field>
          <Field label="Target audience">
            <textarea
              rows={3}
              value={form.audience}
              onChange={(e) => setForm({ ...form, audience: e.target.value })}
            />
          </Field>
        </div>
        <p className="small-text" style={{ margin: "0 0 10px" }}>
          Approval preference
        </p>
        <div className="preference-row">
          <div>
            <strong>Require approval before publishing</strong>
          </div>
          <button
            type="button"
            className={"toggle " + (form.approvalRequired ? "on" : "")}
            role="switch"
            aria-label="Require approval before publishing"
            aria-checked={form.approvalRequired}
            onClick={() =>
              setForm({ ...form, approvalRequired: !form.approvalRequired })
            }
          >
            <span />
          </button>
        </div>
        <div className="settings-support">
          <section className="panel">
            <h3>Connected accounts</h3>
            {["Instagram", "Facebook"].map((name) => (
              <div className="connection-row" key={name}>
                <Platform name={name} />
                <div style={{ flex: 1 }}>
                  <strong>{name}</strong>
                  <small>Not connected · sample layout</small>
                </div>
                <button
                  type="button"
                  className="button compact"
                  onClick={() =>
                    toast("Social account integration is not configured yet.")
                  }
                >
                  Manage
                </button>
              </div>
            ))}
          </section>
          <section className="panel">
            <h3>Team access</h3>
            {[
              ["Sam Lee", "sam@agency.com", "Owner", "sam-avatar"],
              [client.contact, client.email, "Client reviewer", "alex-avatar"],
            ].map(([name, email, role, avatar]) => (
              <div className="team-row" key={role}>
                <img src={`/media/mockup/${avatar}.png`} alt="" />
                <div>
                  <strong>{name}</strong>
                  <small>{email}</small>
                </div>
                <Badge tone={role === "Owner" ? "green" : "blue"}>{role}</Badge>
              </div>
            ))}
            <small className="muted">
              Sample roles · authentication not connected
            </small>
          </section>
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="button"
            onClick={() => setForm(client)}
          >
            Discard changes
          </button>
          <button className="button primary">Save changes</button>
        </div>
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
    <Modal title="Add a client" onClose={onClose}>
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
        <Field label="Client name">
          <input
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Main contact">
          <input value={contact} onChange={(e) => setContact(e.target.value)} />
        </Field>
        <Field label="Contact email">
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
            Add client
          </button>
        </div>
      </form>
    </Modal>
  );
}
