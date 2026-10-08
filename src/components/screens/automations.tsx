"use client";
import { useState } from "react";
import {
  Workflow,
  Play,
  CircleCheck,
  ArrowRight,
  Clock3,
  Unplug,
  Ellipsis,
  Instagram,
  UsersRound,
  FileText,
  ChartNoAxesCombined,
  Mail,
  CircleAlert,
} from "lucide-react";
import { useWorkspace } from "../workspace-provider";
import { Badge, Field, Modal, Status } from "../ui";
import { clientMatch } from "@/lib/domain";
export function AutomationsScreen({
  adding,
  closeAdd,
}: {
  adding: boolean;
  closeAdd: () => void;
}) {
  const { data, clientId, update, toast, activity } = useWorkspace();
  const [selectedId, setSelectedId] = useState("a5");
  const [query, setQuery] = useState("");
  const workflows = data.automations.filter(
    (a) =>
      (clientMatch(a.clientId, clientId) || a.clientId === "all") &&
      a.name.toLowerCase().includes(query.toLowerCase()),
  );
  const selected = workflows.find((a) => a.id === selectedId) || workflows[0];
  const runs = workflows.flatMap((w) => w.runs);
  function simulate() {
    if (!selected) return;
    const run = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      status: "Success" as const,
      detail: "Demo run completed. No external services were called.",
    };
    update((prev) => ({
      ...prev,
      automations: prev.automations.map((a) =>
        a.id === selected.id
          ? { ...a, runs: [run, ...a.runs].slice(0, 30) }
          : a,
      ),
    }));
    activity(`Demo run: ${selected.name}`, selected.clientId);
    toast("Demo run completed · no external actions");
  }
  const failed = selected?.runs[0]?.status === "Failed";
  const icons = [UsersRound, FileText, ChartNoAxesCombined, Mail, Instagram];
  return (
    <>
      <div className="metric-grid three">
        <div className="metric-card">
          <div className="metric-top">
            <span>Active</span>
            <Play size={20} />
          </div>
          <strong>{workflows.filter((a) => a.enabled).length}</strong>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>Successful today</span>
            <CircleCheck size={20} />
          </div>
          <strong>{runs.filter((r) => r.status === "Success").length}</strong>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>Needs attention</span>
            <CircleAlert size={20} />
          </div>
          <strong>
            {workflows.filter((w) => w.runs[0]?.status === "Failed").length}
          </strong>
        </div>
      </div>
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Workflow</th>
                <th>Client</th>
                <th>Trigger</th>
                <th>Status</th>
                <th>Last run</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((a, i) => {
                const Icon = icons[i % icons.length];
                return (
                  <tr
                    key={a.id}
                    className={selected?.id === a.id ? "highlight-row" : ""}
                  >
                    <td>
                      <button
                        className="table-link workflow-name"
                        onClick={() => setSelectedId(a.id)}
                      >
                        <Icon size={23} />
                        {a.name}
                      </button>
                    </td>
                    <td>
                      {data.clients.find((c) => c.id === a.clientId)?.name ||
                        "All clients"}
                    </td>
                    <td>{a.trigger}</td>
                    <td>
                      <button
                        role="switch"
                        aria-checked={a.enabled}
                        aria-label={`Enable ${a.name}`}
                        className={"toggle " + (a.enabled ? "on" : "")}
                        onClick={() => {
                          update((prev) => ({
                            ...prev,
                            automations: prev.automations.map((w) =>
                              w.id === a.id ? { ...w, enabled: !w.enabled } : w,
                            ),
                          }));
                          toast(
                            a.enabled
                              ? "Workflow disabled"
                              : "Workflow enabled locally",
                          );
                        }}
                      >
                        <span />
                      </button>
                      <span className="automation-status">
                        {a.runs[0]?.status === "Failed"
                          ? "Needs attention"
                          : a.enabled
                            ? "Active"
                            : "Disabled"}
                      </span>
                    </td>
                    <td>
                      <span
                        className="status-dot"
                        style={{
                          background:
                            a.runs[0]?.status === "Failed"
                              ? "#e34242"
                              : undefined,
                        }}
                      />{" "}
                      {a.runs[0]
                        ? new Date(a.runs[0].date).toLocaleString()
                        : "Not run yet"}
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Inspect ${a.name}`}
                        onClick={() => setSelectedId(a.id)}
                      >
                        <Ellipsis size={18} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!workflows.length && (
            <p className="empty">No workflows match this filter.</p>
          )}
        </div>
      </section>
      {selected && (
        <section className="panel automation-detail">
          <div className="automation-summary">
            <div>
              <h2>
                {selected.name}{" "}
                <Badge tone={failed ? "red" : "green"}>
                  {failed ? "Failed" : "Ready"}
                </Badge>
              </h2>
              <p>
                {data.clients.find((c) => c.id === selected.clientId)?.name ||
                  "All clients"}
              </p>
              <h3>
                {failed
                  ? "Account connection expired"
                  : "Workflow ready for a demo run"}
              </h3>
              <p>
                {failed
                  ? "Sample failure: the Instagram account needs to be reconnected to continue publishing."
                  : "Run this local simulation to preview the workflow. No external services will be called."}
              </p>
              {failed && (
                <button
                  className="button primary"
                  onClick={() =>
                    toast(
                      "Connect your self-hosted n8n instance before reconnecting accounts.",
                    )
                  }
                >
                  Reconnect account
                </button>
              )}
              <button
                className="button"
                onClick={simulate}
                disabled={!selected.enabled}
                aria-label="Run demo"
              >
                {failed ? "Retry run" : "Run demo"}
              </button>
            </div>
            <div>
              <p>
                Last run{" "}
                <span style={{ float: "right" }}>
                  {selected.runs[0]
                    ? new Date(selected.runs[0].date).toLocaleString()
                    : "Not run yet"}
                </span>
              </p>
              <section className="panel" style={{ padding: 16 }}>
                <h3>Workflow steps</h3>
                <div className="workflow-steps">
                  {[
                    "Content approved",
                    "Check schedule",
                    "Publish post",
                    "Update activity",
                  ].map((s, i) => (
                    <div key={s}>
                      <span className="workflow-step">
                        <span
                          style={{
                            background:
                              failed && i === 2
                                ? "#e55c5c"
                                : i === 3
                                  ? "#d0d6dc"
                                  : undefined,
                          }}
                        >
                          {failed && i === 2 ? "×" : i === 3 ? "…" : "✓"}
                        </span>
                        {s}
                      </span>
                      {i < 3 && <ArrowRight size={22} />}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
          <div className="panel-heading">
            <h3>Run history</h3>
          </div>
          {selected.runs.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date & time</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.runs.map((r) => (
                    <tr key={r.id}>
                      <td>{new Date(r.date).toLocaleString()}</td>
                      <td>
                        <Status value={r.status} />
                      </td>
                      <td>12 seconds (sample)</td>
                      <td>{r.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="subtle-empty">
              No demo runs yet. Enable this workflow and run a simulation.
            </div>
          )}
          <p className="sample-note">
            Local workflow definitions and sample runs · n8n not connected · No
            external actions
          </p>
        </section>
      )}
      <div className="integration-banner">
        <Unplug size={18} />
        <div>
          <strong>Self-hosted n8n</strong>
          <p>Not connected. All workflow activity above is local demo data.</p>
        </div>
      </div>
      {adding && <AutomationForm onClose={closeAdd} />}
    </>
  );
}
function AutomationForm({ onClose }: { onClose: () => void }) {
  const { data, clientId, update, toast } = useWorkspace();
  const [name, setName] = useState("");
  const [client, setClient] = useState(clientId);
  const [trigger, setTrigger] = useState("Content approved");
  return (
    <Modal title="New automation" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          update((prev) => ({
            ...prev,
            automations: [
              ...prev.automations,
              {
                id: crypto.randomUUID(),
                name: name.trim(),
                clientId: client,
                trigger,
                enabled: false,
                runs: [],
              },
            ],
          }));
          toast("Local workflow created");
          onClose();
        }}
      >
        <Field label="Workflow name">
          <input
            required
            maxLength={100}
            placeholder="e.g. Monthly client check-in"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Client">
          <select value={client} onChange={(e) => setClient(e.target.value)}>
            <option value="all">All clients</option>
            {data.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Trigger">
          <select value={trigger} onChange={(e) => setTrigger(e.target.value)}>
            {[
              "Content approved",
              "Form submission",
              "Daily · 9 AM",
              "Every Monday · 9 AM",
              "Manual",
            ].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <p className="muted small-text">
          Creates a local definition. It does not create or activate an n8n
          workflow yet.
        </p>
        <div className="modal-footer">
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary">Create workflow</button>
        </div>
      </form>
    </Modal>
  );
}
