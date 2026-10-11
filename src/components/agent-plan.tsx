"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cloudRequest } from "@/lib/cloud";
import type { AgentRun, ContentPlan } from "@/lib/agent-config";
import { useWorkspace } from "./workspace-provider";
import { Field, Modal } from "./ui";
type AgentData = { models: { key: string; label: string }[]; runs: AgentRun[] };
const activeRun = (run: AgentRun) =>
  ["Queued", "Running", "Awaiting approval"].includes(run.status);
const runLabel = (run: AgentRun) =>
  run.status === "Awaiting approval"
    ? "Ready for Review"
    : run.status === "Completed"
      ? "Drafts Created"
      : run.status;

export function AgentPlan({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const {
    data,
    session,
    clientId,
    setClientId,
    refresh,
    saving,
    storageError,
  } = useWorkspace();
  const [selected, setSelected] = useState(
    clientId === "all" ? data.clients[0]?.id || "" : clientId,
  );
  const [model, setModel] = useState("");
  const [brief, setBrief] = useState(
    "Create a varied five-post content plan for this client's audience.",
  );
  const [remote, setRemote] = useState<AgentData>({ models: [], runs: [] });
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [decision, setDecision] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState<ContentPlan | null>(null);
  const regeneration = useRef<{ fingerprint: string; id: string } | null>(null);
  const editBase = useRef<ContentPlan | null>(null);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const completed = useRef(new Set<string>());
  const initialClient = useRef(clientId);
  const initialLoad = useRef(true);
  const mutation = useRef(0);
  const body = useRef<HTMLDivElement>(null);
  const wid = session?.workspaceId;
  const runs = remote.runs.filter((r) => r.client_id === selected);
  const run = runs.find((r) => r.id === focusedId) || runs.find(activeRun);
  const waiting = run && ["Queued", "Running"].includes(run.status);
  const reviewing = run?.status === "Awaiting approval";
  const success = run?.status === "Completed";
  const proposalKey = JSON.stringify(run?.proposal);
  useEffect(() => {
    if (!editing)
      setEdited(run?.proposal ? structuredClone(run.proposal) : null);
  }, [run?.id, proposalKey, editing]);
  const title = success
    ? "Drafts Created"
    : reviewing
      ? "Review Content Plan"
      : waiting
        ? decision === true
          ? "Creating Drafts"
          : decision === false
            ? "Rejecting Proposal"
            : "Generating Content Plan"
        : run
          ? "Content Plan Result"
          : "Create Content Plan";
  const step = success
    ? 2
    : reviewing || (waiting && decision !== null)
      ? 1
      : 0;
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
    body.current?.focus();
  }, [title, run?.id, editing]);
  useEffect(() => {
    if (!wid || session?.role === "client_reviewer") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const revision = mutation.current;
        const result = await cloudRequest<AgentData>(
          `/api/agents?workspaceId=${wid}`,
        );
        if (cancelled) return;
        if (revision !== mutation.current) {
          timer = setTimeout(load, 1000);
          return;
        }
        setRemote(result);
        setLoaded(true);
        setLoadError("");
        if (initialLoad.current) {
          initialLoad.current = false;
          const pending = result.runs.find(
            (r) =>
              activeRun(r) &&
              (initialClient.current === "all" ||
                r.client_id === initialClient.current),
          );
          if (pending) {
            setSelected(pending.client_id);
            setFocusedId(pending.id);
          }
        }
        const newlyCompleted = result.runs.filter(
          (r) => r.status === "Completed" && !completed.current.has(r.id),
        );
        if (newlyCompleted.length) {
          await refresh();
          if (!cancelled)
            newlyCompleted.forEach((r) => completed.current.add(r.id));
        }
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      }
      if (!cancelled) timer = setTimeout(load, 3000);
    }
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [wid, session?.role, refresh]);

  async function generate() {
    mutation.current++;
    setBusy(true);
    setError("");
    try {
      const modelKey = model || remote.models[0]?.key;
      const fingerprint = JSON.stringify({ wid, selected, modelKey, brief });
      if (request.current?.fingerprint !== fingerprint)
        request.current = { fingerprint, id: crypto.randomUUID() };
      const { runId } = await cloudRequest<{ runId: string }>("/api/agents", {
        action: "generate",
        workspaceId: wid,
        clientId: selected,
        modelKey,
        brief,
        requestId: request.current.id,
      });
      setFocusedId(runId);
      setDecision(null);
      setRemote((prev) => ({
        ...prev,
        runs: [
          {
            id: runId,
            client_id: selected,
            model_key: modelKey,
            brief,
            status: "Queued",
            detail: "Waiting for the AI worker.",
            proposal: null,
            created_at: new Date().toISOString(),
          },
          ...prev.runs.filter((r) => r.id !== runId),
        ],
      }));
      request.current = null;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      mutation.current++;
      setBusy(false);
    }
  }
  async function decide(approved: boolean) {
    if (!run) return;
    mutation.current++;
    setBusy(true);
    setError("");
    try {
      await cloudRequest("/api/agents", {
        action: "decide",
        workspaceId: wid,
        runId: run.id,
        approved,
        expectedProposal: run.proposal,
      });
      setDecision(approved);
      setFocusedId(run.id);
      setRemote((prev) => ({
        ...prev,
        runs: prev.runs.map((r) =>
          r.id === run.id
            ? {
                ...r,
                status: "Queued",
                detail: approved
                  ? "Saving your five drafts."
                  : "Rejecting the proposal.",
              }
            : r,
        ),
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      mutation.current++;
      setBusy(false);
    }
  }
  function newPlan() {
    setEditing(false);
    setFocusedId(null);
    setDecision(null);
    setError("");
  }
  const blocked = busy || saving || Boolean(storageError) || Boolean(loadError);
  const client = data.clients.find((c) => c.id === selected);
  function changePost(index: number, field: string, value: string) {
    setEdited((prev) =>
      prev
        ? {
            posts: prev.posts.map((p, i) =>
              i === index ? { ...p, [field]: value } : p,
            ),
          }
        : prev,
    );
  }
  async function saveEdits() {
    if (!run || !edited) return;
    mutation.current++;
    setBusy(true);
    setError("");
    try {
      await cloudRequest("/api/agents", {
        action: "edit",
        workspaceId: wid,
        runId: run.id,
        expectedProposal: editBase.current,
        proposal: edited,
      });
      setRemote((prev) => ({
        ...prev,
        runs: prev.runs.map((r) =>
          r.id === run.id ? { ...r, proposal: edited } : r,
        ),
      }));
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      mutation.current++;
      setBusy(false);
    }
  }
  async function regenerate(index: number) {
    if (!run) return;
    mutation.current++;
    setBusy(true);
    setError("");
    try {
      const fingerprint = JSON.stringify({
        id: run.id,
        index,
        proposal: run.proposal,
      });
      if (regeneration.current?.fingerprint !== fingerprint)
        regeneration.current = { fingerprint, id: crypto.randomUUID() };
      await cloudRequest("/api/agents", {
        action: "regenerate",
        workspaceId: wid,
        runId: run.id,
        index,
        requestId: regeneration.current.id,
        expectedProposal: run.proposal,
      });
      setRemote((prev) => ({
        ...prev,
        runs: prev.runs.map((r) =>
          r.id === run.id
            ? {
                ...r,
                status: "Queued",
                detail: `Regenerating post ${index + 1}.`,
              }
            : r,
        ),
      }));
      setDecision(null);
      regeneration.current = null;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      mutation.current++;
      setBusy(false);
    }
  }
  async function retry() {
    if (!run) return;
    mutation.current++;
    setBusy(true);
    setError("");
    try {
      await cloudRequest("/api/agents", {
        action: "retry",
        workspaceId: wid,
        runId: run.id,
      });
      setRemote((prev) => ({
        ...prev,
        runs: prev.runs.map((r) =>
          r.id === run.id
            ? { ...r, status: "Queued", detail: "Retry queued." }
            : r,
        ),
      }));
      setDecision(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      mutation.current++;
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose} className="agent-wizard">
      <ol className="agent-steps" aria-label="Plan Steps">
        {["Create", "Review", "Drafts"].map((label, index) => (
          <li
            key={label}
            aria-current={step === index ? "step" : undefined}
            className={step >= index ? "current" : ""}
          >
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <div className="agent-body" ref={body} tabIndex={-1}>
        {!session || session.role === "client_reviewer" ? (
          <p>
            AI draft generation is available to owners and assigned team
            members.
          </p>
        ) : !loaded && !run ? (
          <p role="status">Loading your content plans…</p>
        ) : (
          <>
            {!run && (
              <>
                <p className="muted">
                  Create five captions using your client's voice and audience.
                  You'll review the plan before saving drafts.
                </p>
                <Field label="Client">
                  <select
                    value={selected}
                    onChange={(e) => {
                      setSelected(e.target.value);
                      newPlan();
                    }}
                    disabled={busy}
                  >
                    {data.clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="AI Model">
                  <select
                    value={model || remote.models[0]?.key || ""}
                    onChange={(e) => setModel(e.target.value)}
                    disabled={busy}
                  >
                    {remote.models.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {!remote.models.length && (
                  <p role="status">
                    No AI model configured. Ask your administrator to configure
                    a provider and start the AI worker.
                  </p>
                )}
                <Field label="Content Brief">
                  <textarea
                    rows={4}
                    maxLength={4000}
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    disabled={busy}
                  />
                </Field>
                {!!runs.length && (
                  <details className="agent-history">
                    <summary>Recent Plans</summary>
                    {runs.slice(0, 10).map((r) => (
                      <button
                        className="button"
                        key={r.id}
                        onClick={() => {
                          setFocusedId(r.id);
                          setDecision(null);
                        }}
                      >
                        {runLabel(r)} ·{" "}
                        {new Date(r.created_at).toLocaleDateString()}
                      </button>
                    ))}
                  </details>
                )}
              </>
            )}
            {waiting && (
              <div className="agent-progress" role="status">
                <span className="agent-spinner" aria-hidden="true" />
                <p>
                  {client?.name} · {run.detail}
                </p>
                <p className="muted">
                  You can close this dialog. Reopen Draft Plan to continue when
                  it's ready.
                </p>
              </div>
            )}
            {reviewing && (
              <>
                <p className="agent-review-intro">
                  <strong>Ready for Review</strong>
                  <span className="muted">
                    {client?.name} · Five proposed posts. Review every caption
                    before creating drafts.
                  </span>
                </p>
                {!editing && (
                  <button
                    className="button"
                    disabled={blocked}
                    onClick={() => {
                      editBase.current = structuredClone(run.proposal);
                      setEdited(structuredClone(run.proposal));
                      setEditing(true);
                    }}
                  >
                    Edit Plan, Dates and Assets
                  </button>
                )}
                {(editing ? edited : run.proposal)?.posts.map((post, index) => (
                  <article className="agent-post" key={index}>
                    <div className="agent-post-meta">
                      <span>Post {index + 1} of 5</span>
                      <span>{post.platform}</span>
                    </div>
                    {editing ? (
                      <>
                        <Field label={`Post ${index + 1} Title`}>
                          <input
                            maxLength={200}
                            value={post.title}
                            onChange={(e) =>
                              changePost(index, "title", e.target.value)
                            }
                          />
                        </Field>
                        <Field label={`Post ${index + 1} Caption`}>
                          <textarea
                            rows={5}
                            maxLength={5000}
                            value={post.caption}
                            onChange={(e) =>
                              changePost(index, "caption", e.target.value)
                            }
                          />
                        </Field>
                        <Field label={`Post ${index + 1} Platform`}>
                          <select
                            value={post.platform}
                            onChange={(e) =>
                              changePost(index, "platform", e.target.value)
                            }
                          >
                            {[
                              "Instagram",
                              "Facebook",
                              "LinkedIn",
                              "TikTok",
                              "X",
                            ].map((p) => (
                              <option key={p}>{p}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label={`Post ${index + 1} Date`}>
                          <input
                            type="date"
                            value={post.date || ""}
                            onChange={(e) =>
                              changePost(index, "date", e.target.value)
                            }
                          />
                        </Field>
                        <Field label={`Post ${index + 1} Time`}>
                          <input
                            type="time"
                            value={post.time || "09:00"}
                            onChange={(e) =>
                              changePost(index, "time", e.target.value)
                            }
                          />
                        </Field>
                        <Field label={`Post ${index + 1} Asset`}>
                          <select
                            value={post.assetId || ""}
                            onChange={(e) =>
                              changePost(index, "assetId", e.target.value)
                            }
                          >
                            <option value="">No Asset</option>
                            {data.assets
                              .filter((a) => a.clientId === selected)
                              .map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                          </select>
                        </Field>
                      </>
                    ) : (
                      <>
                        <h3>{post.title}</h3>
                        <p>{post.caption}</p>
                        {post.date && (
                          <p className="muted">
                            Draft date: {post.date} · {post.time || "09:00"}
                          </p>
                        )}
                        {post.assetId && (
                          <p className="muted">
                            Asset:{" "}
                            {
                              data.assets.find((a) => a.id === post.assetId)
                                ?.name
                            }
                          </p>
                        )}
                        <button
                          className="button"
                          style={{ marginTop: 12 }}
                          disabled={blocked}
                          onClick={() => void regenerate(index)}
                        >
                          Regenerate Post {index + 1}
                        </button>
                      </>
                    )}
                  </article>
                ))}
                {!run.proposal && (
                  <p role="alert">
                    The proposal could not be loaded. Close and reopen the
                    dialog.
                  </p>
                )}
              </>
            )}
            {success && (
              <div className="agent-result" role="status">
                <h3>5 Drafts Created for {client?.name}</h3>
                <p>Your drafts are in Content Calendar → Unscheduled Ideas.</p>
                <p className="muted">
                  Add assets and dates, then submit them through the usual
                  content approval process.
                </p>
              </div>
            )}
            {run && !waiting && !reviewing && !success && (
              <div className="agent-result" role="status">
                <h3>
                  {run.status === "Rejected"
                    ? "Proposal Rejected"
                    : "Plan Could Not Be Created"}
                </h3>
                <p>{run.detail}</p>
              </div>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
        {loadError && <p role="alert">{loadError}</p>}
        {storageError && (
          <p role="alert">
            Refresh the workspace to resolve unsaved changes before continuing.
          </p>
        )}
      </div>
      <div className="agent-footer">
        {!run && (
          <>
            <button className="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={
                blocked ||
                !loaded ||
                !session ||
                session.role === "client_reviewer" ||
                !selected ||
                !brief.trim() ||
                !remote.models.length
              }
              onClick={() => void generate()}
            >
              {busy ? "Queuing Plan…" : "Generate AI Content Plan"}
            </button>
          </>
        )}
        {waiting && (
          <button className="button" onClick={onClose}>
            Close and Continue Later
          </button>
        )}
        {reviewing && editing && (
          <>
            <button
              className="button"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel Edits
            </button>
            <button
              className="button primary"
              disabled={blocked}
              onClick={() => void saveEdits()}
            >
              Save Plan Changes
            </button>
          </>
        )}
        {reviewing && !editing && (
          <>
            <button
              className="button"
              disabled={blocked}
              onClick={() => void decide(false)}
            >
              Reject Proposal
            </button>
            <button
              className="button primary"
              disabled={blocked || !run.proposal}
              onClick={() => void decide(true)}
            >
              {busy ? "Saving Decision…" : "Create 5 Drafts"}
            </button>
          </>
        )}
        {success && (
          <>
            <button className="button" onClick={newPlan}>
              Create Another Plan
            </button>
            <button
              className="button primary"
              onClick={() => {
                setClientId(run.client_id);
                void refresh();
                router.push("/calendar#unscheduled-ideas");
                onClose();
              }}
            >
              View Drafts
            </button>
          </>
        )}
        {run && !waiting && !reviewing && !success && (
          <>
            <button className="button" onClick={onClose}>
              Close
            </button>
            <button className="button primary" onClick={newPlan}>
              Create Another Plan
            </button>
            {run.status === "Failed" && (
              <button
                className="button"
                disabled={blocked}
                onClick={() => void retry()}
              >
                Retry Failed Run
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
