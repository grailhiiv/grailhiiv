"use client";
import { useState } from "react";
import {
  Search,
  ArrowUpRight,
  Mail,
  CalendarDays,
  MessageSquare,
  X,
  Columns3,
  List,
  Ellipsis,
  Phone,
  Building2,
  Link2,
  CircleCheck,
} from "lucide-react";
import { useWorkspace } from "../workspace-provider";
import { Badge, ClientMark, Empty, Field, Modal, Status } from "../ui";
import { clientMatch, formatDate } from "@/lib/domain";
import type { Lead, LeadStage } from "@/lib/types";
const stages: LeadStage[] = ["New", "Qualified", "Contacted", "Won"];
const SendIcon = Mail;
export function LeadsScreen({
  adding,
  closeAdd,
}: {
  adding: boolean;
  closeAdd: () => void;
}) {
  const { data, clientId, setClientId, update, toast, activity } =
    useWorkspace();
  const [query, setQuery] = useState("");
  const [view, setView] = useState("Pipeline");
  const [source, setSource] = useState("all");
  const [selectedId, setSelectedId] = useState("l2");
  const [note, setNote] = useState("");
  const [editingTask, setEditingTask] = useState(false);
  const leads = data.leads.filter(
    (l) =>
      clientMatch(l.clientId, clientId) &&
      (source === "all" || l.source === source) &&
      `${l.name} ${l.email} ${l.interest}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const selected = leads.find((l) => l.id === selectedId);
  function changeStage(lead: Lead, stage: LeadStage) {
    update((prev) => ({
      ...prev,
      leads: prev.leads.map((l) => (l.id === lead.id ? { ...l, stage } : l)),
    }));
    activity(`${lead.name} moved to ${stage}`, lead.clientId);
    toast("Lead stage updated");
  }
  function addNote() {
    if (!selected || !note.trim()) return;
    update((prev) => ({
      ...prev,
      leads: prev.leads.map((l) =>
        l.id === selected.id
          ? {
              ...l,
              notes: [
                ...l.notes,
                { text: note.trim(), date: new Date().toISOString() },
              ],
            }
          : l,
      ),
    }));
    setNote("");
    toast("Note saved");
  }
  return (
    <>
      <div className="toolbar">
        <div className="segmented">
          {[
            ["Pipeline", Columns3],
            ["List", List],
          ].map(([label, Icon]) => {
            const Component = Icon as typeof Columns3;
            return (
              <button
                key={label as string}
                className={view === label ? "selected" : ""}
                onClick={() => setView(label as string)}
              >
                <Component size={16} />
                {label as string}
              </button>
            );
          })}
        </div>
        <label className="search-box">
          <Search size={19} />
          <input
            aria-label="Search leads"
            placeholder="Search leads…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="CRM client"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        >
          <option value="all">All clients</option>
          {data.clients.map((c) => (
            <option value={c.id} key={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Lead source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="all">All sources</option>
          {Array.from(new Set(data.leads.map((l) => l.source))).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className={"crm-layout " + (selected ? "with-detail" : "")}>
        <div>
          {view === "Pipeline" ? (
            <div className="kanban">
              {stages.map((stage) => (
                <section
                  className={"kanban-column " + stage.toLowerCase()}
                  key={stage}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain");
                    const lead = leads.find((l) => l.id === id);
                    if (lead) changeStage(lead, stage);
                  }}
                >
                  <div className="kanban-heading">
                    <h2>{stage}</h2>
                    <span>{leads.filter((l) => l.stage === stage).length}</span>
                  </div>
                  {leads
                    .filter((l) => l.stage === stage)
                    .map((l) => (
                      <button
                        className={
                          "lead-card " + (selectedId === l.id ? "selected" : "")
                        }
                        key={l.id}
                        draggable
                        onDragStart={(e) =>
                          e.dataTransfer.setData("text/plain", l.id)
                        }
                        onClick={() => {
                          setSelectedId(l.id);
                          setNote("");
                        }}
                      >
                        <div className="lead-card-title">
                          <strong>{l.name}</strong>
                          <Ellipsis size={16} />
                        </div>
                        <span className="lead-client">
                          {data.clients.find((c) => c.id === l.clientId)?.name}
                        </span>
                        <Badge
                          tone={
                            l.source === "Referral"
                              ? "purple"
                              : l.source === "Google Ads"
                                ? "amber"
                                : l.source === "Instagram"
                                  ? "red"
                                  : "blue"
                          }
                        >
                          {l.source}
                        </Badge>
                        <div className="lead-task">
                          <img
                            src={
                              "/media/mockup/" +
                              (l.id === "l2"
                                ? "jamie-avatar"
                                : l.clientId === "bloom"
                                  ? "alex-avatar"
                                  : "sam-avatar") +
                              ".png"
                            }
                            alt=""
                          />
                          <div>
                            {l.task}
                            <span>
                              {formatDate(l.due).replace(", 2026", "")}
                            </span>
                          </div>
                          <small>{l.interest}</small>
                        </div>
                      </button>
                    ))}
                  {!leads.some((l) => l.stage === stage) && (
                    <div className="kanban-empty">Move a lead here</div>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <section className="panel table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Client</th>
                    <th>Source</th>
                    <th>Stage</th>
                    <th>Next task</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <button
                          className="table-link"
                          onClick={() => setSelectedId(l.id)}
                        >
                          {l.name}
                        </button>
                      </td>
                      <td>
                        {data.clients.find((c) => c.id === l.clientId)?.name}
                      </td>
                      <td>{l.source}</td>
                      <td>
                        <select
                          aria-label={`Stage for ${l.name}`}
                          value={l.stage}
                          onChange={(e) =>
                            changeStage(l, e.target.value as LeadStage)
                          }
                        >
                          {stages.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </td>
                      <td>{l.task}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!leads.length && (
                <Empty title="No matching leads">
                  Try a different search or add your first lead.
                </Empty>
              )}
            </section>
          )}
        </div>
        {selected && (
          <aside className="panel lead-detail">
            <div className="detail-top">
              <img
                className="lead-portrait"
                src={
                  "/media/mockup/" +
                  (selected.id === "l2" ? "emily-avatar" : "sam-avatar") +
                  ".png"
                }
                alt=""
              />
              <button
                className="icon-button"
                aria-label="Close lead details"
                onClick={() => setSelectedId("")}
              >
                <X size={20} />
              </button>
            </div>
            <h2>{selected.name}</h2>
            <p className="muted">
              {data.clients.find((c) => c.id === selected.clientId)?.name}
            </p>
            <select
              aria-label="Lead stage"
              value={selected.stage}
              onChange={(e) =>
                changeStage(selected, e.target.value as LeadStage)
              }
            >
              {stages.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <div className="contact-line">
              <Mail size={19} />
              <a href={`mailto:${selected.email}`}>{selected.email}</a>
            </div>
            <div className="contact-line">
              <Phone size={19} />
              <span>
                (555) 123-4567 <small>Sample</small>
              </span>
            </div>
            <div className="contact-line">
              <Building2 size={19} />
              {data.clients.find((c) => c.id === selected.clientId)?.name}
            </div>
            <div className="contact-line">
              <Link2 size={19} />
              {selected.source}
            </div>
            <div className="detail-section">
              <h3>Qualification summary</h3>
              <p>Interested in {selected.interest.toLowerCase()}.</p>
            </div>
            <div className="detail-section">
              <h3>Next task</h3>
              <p>
                <CalendarDays
                  size={20}
                  style={{
                    display: "inline",
                    verticalAlign: "middle",
                    marginRight: 10,
                  }}
                />
                {selected.task} ·{" "}
                {formatDate(selected.due).replace(", 2026", "")}
              </p>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  className="button"
                  onClick={() => document.getElementById("lead-note")?.focus()}
                >
                  Add note
                </button>
                <button
                  className="button primary"
                  onClick={() => setEditingTask(true)}
                  aria-label="Edit follow-up"
                >
                  Create task
                </button>
              </div>
            </div>
            <div className="detail-section">
              <h3>Activity timeline</h3>
              {[
                ["Form submitted", Mail],
                ["Lead qualified", CircleCheck],
                ["Intro email sent", SendIcon],
              ].map(([label, Icon]) => {
                const Component = Icon as typeof Mail;
                return (
                  <div className="lead-timeline" key={String(label)}>
                    <Component size={20} />
                    <div>
                      {String(label)}
                      <small>Oct 8, 2026 · Sample activity</small>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="detail-section">
              <h3>
                <MessageSquare size={16} />
                Notes
              </h3>
              {selected.notes.map((n, i) => (
                <div className="lead-note" key={i}>
                  <p>{n.text}</p>
                  <small>{new Date(n.date).toLocaleString()}</small>
                </div>
              ))}
              <textarea
                id="lead-note"
                aria-label="Lead note"
                placeholder="Add a note…"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                className="button primary compact full"
                disabled={!note.trim()}
                onClick={addNote}
              >
                Save note
              </button>
            </div>
          </aside>
        )}
      </div>
      {adding && <LeadForm onClose={closeAdd} />}{" "}
      {editingTask && selected && (
        <TaskForm lead={selected} onClose={() => setEditingTask(false)} />
      )}
    </>
  );
}
function LeadForm({ onClose }: { onClose: () => void }) {
  const { data, clientId, update, activity, toast } = useWorkspace();
  const [form, setForm] = useState({
    name: "",
    email: "",
    clientId: clientId === "all" ? data.clients[0].id : clientId,
    source: "Website form",
    interest: "",
    task: "Send an introductory email",
    due: "2026-10-09",
  });
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const lead: Lead = {
      ...form,
      name: form.name.trim(),
      email: form.email.trim(),
      id: crypto.randomUUID(),
      stage: "New",
      notes: [],
    };
    if (!lead.name) return;
    update((prev) => ({ ...prev, leads: [lead, ...prev.leads] }));
    activity(`New lead added: ${lead.name}`, lead.clientId);
    toast("Lead added");
    onClose();
  }
  return (
    <Modal title="Add a lead" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Full name">
          <input
            required
            maxLength={100}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Email">
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <div className="form-grid">
          <Field label="Client">
            <select
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
            >
              {data.clients.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Source">
            <select
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            >
              {[
                "Website form",
                "Referral",
                "Instagram",
                "Facebook",
                "LinkedIn",
                "Other",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="What are they interested in?">
          <textarea
            required
            rows={3}
            value={form.interest}
            onChange={(e) => setForm({ ...form, interest: e.target.value })}
          />
        </Field>
        <Field label="Follow-up date">
          <input
            required
            type="date"
            value={form.due}
            onChange={(e) => setForm({ ...form, due: e.target.value })}
          />
        </Field>
        <div className="modal-footer">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary">Add lead</button>
        </div>
      </form>
    </Modal>
  );
}
function TaskForm({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { update, toast } = useWorkspace();
  const [task, setTask] = useState(lead.task);
  const [due, setDue] = useState(lead.due);
  return (
    <Modal title="Edit follow-up" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!task.trim()) return;
          update((prev) => ({
            ...prev,
            leads: prev.leads.map((l) =>
              l.id === lead.id ? { ...l, task: task.trim(), due } : l,
            ),
          }));
          toast("Follow-up saved");
          onClose();
        }}
      >
        <Field label="Task">
          <input
            required
            value={task}
            onChange={(e) => setTask(e.target.value)}
          />
        </Field>
        <Field label="Due date">
          <input
            type="date"
            required
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </Field>
        <div className="modal-footer">
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary">Save follow-up</button>
        </div>
      </form>
    </Modal>
  );
}
