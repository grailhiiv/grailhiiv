"use client";
import { titleLabel } from "@/lib/labels";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  Play,
  RefreshCw,
  Workflow,
} from "lucide-react";
import { useWorkspace } from "../workspace-provider";
import { Badge } from "../ui";
import { cloudRequest } from "@/lib/cloud";
import { clientMatch } from "@/lib/domain";
import type { AutomationConnection } from "@/lib/n8n-types";
import { AutomationForm } from "./automation-form";

export function CloudAutomations({
  adding,
  closeAdd,
}: {
  adding: boolean;
  closeAdd: () => void;
}) {
  const { data, clientId, session, update, toast, storageError, saving } =
    useWorkspace();
  const requestIds = useRef(new Map<string, string>());
  const [connection, setConnection] = useState<AutomationConnection | null>(
    null,
  );
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const lastRead = useRef(0);
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");
  const workspaceId = session?.workspaceId;
  const owner = session?.role === "owner";
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!workspaceId) return;
      const attempt = ++lastRead.current;
      try {
        const response = await fetch(
          `/api/automations?workspaceId=${workspaceId}`,
          {
            cache: "no-store",
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
              : AbortSignal.timeout(10000),
          },
        );
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Automation service unavailable.");
        if (!signal?.aborted && attempt === lastRead.current) {
          setConnection(result);
          setError("");
        }
      } catch (e) {
        if (!signal?.aborted && attempt === lastRead.current)
          setError((e as Error).message);
      }
    },
    [workspaceId],
  );
  useEffect(() => {
    const controller = new AbortController();
    setConnection(null);
    void load(controller.signal);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(controller.signal);
    }, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [load]);
  async function action(automationId: string, workflowKey?: string) {
    if (!workspaceId) return;
    setBusy(automationId);
    setActionError("");
    try {
      if (workflowKey === undefined && !requestIds.current.has(automationId))
        requestIds.current.set(automationId, crypto.randomUUID());
      await cloudRequest(
        "/api/automations",
        workflowKey === undefined
          ? {
              action: "run",
              workspaceId,
              automationId,
              requestId: requestIds.current.get(automationId),
            }
          : {
              action: "bind",
              workspaceId,
              automationId,
              workflowKey: workflowKey || null,
            },
      );
      requestIds.current.delete(automationId);
      toast(
        workflowKey === undefined ? "Run queued" : "Workflow connection saved",
      );
      await load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const workflows = data.automations.filter(
    (a) =>
      clientMatch(a.clientId, clientId) &&
      a.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const visibleIds = new Set(workflows.map((a) => a.id));
  const runs =
    connection?.runs.filter((r) => visibleIds.has(r.automation_id)) || [];
  const attention = workflows.filter((a) => {
    const latest = runs.find((r) => r.automation_id === a.id);
    return latest && ["Failed", "Unknown"].includes(latest.status);
  }).length;
  return (
    <>
      <div className="integration-banner automation-connection">
        <Workflow size={22} />
        <div>
          <strong>Self-hosted n8n</strong>
          <p role="status">
            {error
              ? "Automation service unavailable. Refresh to check again."
              : !connection
                ? "Checking automation service…"
                : !connection.configured
                  ? "Ask your administrator to configure the automation service."
                  : connection.reachable
                    ? "n8n is reachable. Connected workflows can run manually."
                    : "n8n is unreachable. Check the service before starting a run."}
          </p>
        </div>
        <button className="button" onClick={() => void load()}>
          <RefreshCw size={16} /> Refresh Automations
        </button>
      </div>
      <div className="metric-grid three" aria-label="Automation Summary">
        {[
          {
            label: "Enabled",
            value: workflows.filter((a) => a.enabled).length,
            Icon: Play,
          },
          {
            label: "Recent successes",
            value: connection
              ? runs.filter((r) => r.status === "Success").length
              : "—",
            Icon: CircleCheck,
          },
          {
            label: "Needs attention",
            value: connection ? attention : "—",
            Icon: CircleAlert,
          },
        ].map(({ label, value, Icon }) => (
          <div className="metric-card" key={label}>
            <div className="metric-top">
              <span>{titleLabel(label)}</span>
              <Icon size={20} aria-hidden="true" />
            </div>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="storage-warning">
          {error}
        </p>
      )}
      {actionError && (
        <p role="alert" className="storage-warning">
          {actionError}
        </p>
      )}
      <section className="panel automation-panel">
        <div className="panel-heading">
          <h2>Workflows</h2>
          <input
            aria-label="Search Automations"
            name="automation-search"
            type="search"
            autoComplete="off"
            placeholder="Search automations…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Automation Workflows"
        >
          <table
            className="automation-workflow-table"
            aria-label="Automation Workflows"
          >
            <thead>
              <tr>
                <th>Automation</th>
                <th>Client</th>
                <th>Workflow</th>
                <th>Enabled</th>
                <th>Latest Run</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((a) => {
                const binding = connection?.bindings.find(
                  (b) => b.automation_id === a.id,
                );
                const latest = connection?.runs.find(
                  (r) => r.automation_id === a.id,
                );
                const configuredWorkflow = connection?.workflows.find(
                  (w) => w.key === binding?.workflow_key,
                );
                const active = connection?.runs.some(
                  (r) =>
                    r.automation_id === a.id &&
                    ["Queued", "Running"].includes(r.status),
                );
                const unavailable = Boolean(
                  busy || saving || storageError || error || !connection,
                );
                return (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.name}</strong>
                      <p className="muted small-text">Manual execution</p>
                    </td>
                    <td>
                      {data.clients.find((c) => c.id === a.clientId)?.name}
                    </td>
                    <td>
                      {owner ? (
                        <select
                          aria-label={`Workflow for ${a.name}`}
                          value={binding?.workflow_key || ""}
                          disabled={unavailable || active}
                          onChange={(e) => void action(a.id, e.target.value)}
                        >
                          <option value="">Not Connected</option>
                          {binding &&
                            !connection?.workflows.some(
                              (w) => w.key === binding.workflow_key,
                            ) && (
                              <option value={binding.workflow_key}>
                                Unavailable Workflow
                              </option>
                            )}
                          {connection?.workflows.map((w) => (
                            <option key={w.key} value={w.key}>
                              {w.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        configuredWorkflow?.label ||
                        (binding ? "Unavailable workflow" : "Not connected")
                      )}
                    </td>
                    <td>
                      <button
                        className={"toggle " + (a.enabled ? "on" : "")}
                        role="switch"
                        aria-checked={a.enabled}
                        aria-label={`Enable ${a.name}`}
                        disabled={unavailable}
                        onClick={() =>
                          update((prev) => ({
                            ...prev,
                            automations: prev.automations.map((w) =>
                              w.id === a.id ? { ...w, enabled: !w.enabled } : w,
                            ),
                          }))
                        }
                      >
                        <span />
                      </button>
                    </td>
                    <td>
                      {latest ? (
                        <Badge
                          tone={
                            latest.status === "Success"
                              ? "green"
                              : latest.status === "Failed" ||
                                  latest.status === "Unknown"
                                ? "red"
                                : undefined
                          }
                        >
                          {latest.status}
                        </Badge>
                      ) : (
                        "Not run yet"
                      )}
                    </td>
                    <td>
                      <button
                        className="button"
                        aria-label={`Run ${a.name}`}
                        disabled={
                          unavailable ||
                          !a.enabled ||
                          !configuredWorkflow ||
                          active ||
                          !connection?.configured ||
                          !connection.reachable
                        }
                        onClick={() => void action(a.id)}
                      >
                        <Play size={16} />
                        {active
                          ? "In Progress"
                          : busy === a.id
                            ? "Saving…"
                            : latest?.status === "Failed"
                              ? "Retry Run"
                              : "Run Workflow"}
                      </button>
                      {!active && (
                        <p className="muted small-text automation-run-hint">
                          {!connection
                            ? "Checking connection…"
                            : error
                              ? "Refresh the service status."
                              : !connection.configured
                                ? "Configure n8n first."
                                : !connection.reachable
                                  ? "Restore the n8n connection."
                                  : !binding
                                    ? "Connect a workflow first."
                                    : !configuredWorkflow
                                      ? "Choose an available workflow."
                                      : !a.enabled
                                        ? "Enable this automation first."
                                        : ""}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="automation-scroll-note">
          Scroll horizontally to see all columns.
        </p>
        {!workflows.length && (
          <p className="empty">
            {query.trim()
              ? "No automations match your search."
              : data.automations.length
                ? "No automations for this client."
                : "Create an automation to connect a workflow."}
          </p>
        )}
        <p className="sample-note">
          {owner
            ? "Choose an administrator-configured workflow, enable it, then run it."
            : "Owners manage workflow connections. You can run enabled workflows for your assigned clients."}{" "}
          Automatic triggers and social publishing are not connected.
        </p>
      </section>
      <section className="panel automation-panel">
        <div className="panel-heading">
          <h2>Run History</h2>
          <span className="muted small-text">
            Latest 200 workspace runs · filtered to these automations
          </span>
        </div>
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Automation Run History"
        >
          <table
            className="automation-run-table"
            aria-label="Automation Run History"
          >
            <thead>
              <tr>
                <th>Automation</th>
                <th>Requested</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    {
                      data.automations.find((a) => a.id === r.automation_id)
                        ?.name
                    }
                    <p className="muted small-text">
                      {r.execution_id ? `Execution ${r.execution_id}` : ""}
                    </p>
                  </td>
                  <td>
                    <time dateTime={r.created_at}>
                      {new Date(r.created_at).toLocaleString()}
                    </time>
                  </td>
                  <td>
                    <Badge
                      tone={
                        r.status === "Success"
                          ? "green"
                          : ["Failed", "Unknown"].includes(r.status)
                            ? "red"
                            : undefined
                      }
                    >
                      {r.status}
                    </Badge>
                  </td>
                  <td>
                    {r.started_at && r.finished_at
                      ? `${Math.max(0, Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000))} seconds`
                      : "—"}
                  </td>
                  <td>
                    {r.detail}
                    {r.status === "Unknown" && (
                      <p className="small-text">
                        The action may have executed. Ask an administrator to
                        check n8n before starting another run.
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="automation-scroll-note">
          Scroll horizontally to see all columns.
        </p>
        {!runs.length && <p className="empty">No execution history yet.</p>}
      </section>
      {adding && <AutomationForm onClose={closeAdd} />}
    </>
  );
}
