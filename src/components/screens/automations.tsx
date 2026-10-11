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
  UsersRound,
  FileText,
  ChartNoAxesCombined,
  Mail,
  CircleAlert,
} from "lucide-react";
import { useWorkspace } from "../workspace-provider";
import { Badge, Status } from "../ui";
import { SocialIcon } from "../social-icon";
import { AutomationForm } from "./automation-form";
import { clientMatch } from "@/lib/domain";
import { CloudAutomations } from "./cloud-automations";
function InstagramIcon({ size = 20 }: { size?: number }) {
  return <SocialIcon name="Instagram" size={size} />;
}
export function AutomationsScreen({
  adding,
  closeAdd,
}: {
  adding: boolean;
  closeAdd: () => void;
}) {
  const { cloud, session } = useWorkspace();
  return cloud ? (
    <CloudAutomations
      key={session?.workspaceId}
      adding={adding}
      closeAdd={closeAdd}
    />
  ) : (
    <DemoAutomationsScreen adding={adding} closeAdd={closeAdd} />
  );
}
function DemoAutomationsScreen({
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
      a.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const selected = workflows.find((a) => a.id === selectedId) || workflows[0];
  const runs = workflows.flatMap((w) => w.runs);
  const today = new Date().toDateString();
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
  const icons = [UsersRound, FileText, ChartNoAxesCombined, Mail, InstagramIcon];
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
          <strong>
            {
              runs.filter(
                (r) =>
                  r.status === "Success" &&
                  new Date(r.date).toDateString() === today,
              ).length
            }
          </strong>
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
        <div className="panel-heading">
          <h2>Workflows</h2>
          <input
            aria-label="Search Automations"
            type="search"
            name="automation-search"
            autoComplete="off"
            placeholder="Search automations…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <p className="automation-scroll-note">Scroll horizontally to see all columns.</p>
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Demo Workflows"
        >
          <table>
            <thead>
              <tr>
                <th>Workflow</th>
                <th>Client</th>
                <th>Trigger</th>
                <th>Status</th>
                <th>Last Run</th>
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
                        {!a.enabled ? "Disabled" : a.runs[0]?.status === "Failed" ? "Needs attention" : "Active"}
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
                  {failed ? "Failed" : selected.enabled ? "Ready" : "Disabled"}
                </Badge>
              </h2>
              <p>
                {data.clients.find((c) => c.id === selected.clientId)?.name ||
                  "All clients"}
              </p>
              <h3>
                {failed
                  ? "Account Connection Expired"
                  : "Workflow Ready for a Demo Run"}
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
                  Reconnect Account
                </button>
              )}
              <button
                className="button"
                onClick={simulate}
                disabled={!selected.enabled}
                aria-label="Run Demo"
              >
                {failed ? "Retry Run" : "Run Demo"}
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
                <h3>Workflow Steps</h3>
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
            <h3>Run History</h3>
          </div>
          {selected.runs.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date & Time</th>
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
      <div className="integration-banner automation-connection demo-connection">
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
