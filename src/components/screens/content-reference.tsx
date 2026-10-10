"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  UsersRound,
  CalendarClock,
  CircleCheck,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Send,
  Pencil,
  Bot,
  FileText,
  Ellipsis,
  CalendarDays,
} from "lucide-react";
import { useWorkspace } from "../workspace-provider";
import {
  AssetPreview,
  Badge,
  ClientMark,
  Empty,
  Platform,
  Status,
  Modal,
  Field,
} from "../ui";
import {
  changePostStatus,
  clientMatch,
  formatDate,
  formatTime,
  monthCells,
} from "@/lib/domain";
import type { Post, PostStatus } from "@/lib/types";
type ContentProps = {
  create: (date?: string) => void;
  edit: (post: Post) => void;
};
function useContent() {
  const workspace = useWorkspace();
  const { data, update, toast, activity, cloud } = workspace;
  function status(post: Post, next: PostStatus) {
    try {
      const client = data.clients.find((c) => c.id === post.clientId)!;
      const record = changePostStatus(post, next, client.approvalRequired);
      update((prev) => ({
        ...prev,
        posts: prev.posts.map((p) => (p.id === post.id ? record : p)),
      }));
      activity(`${post.title} · ${next}`, post.clientId);
      toast(
        next === "Scheduled"
          ? cloud
            ? "Approval submitted to the shared schedule"
            : "Approved and added to your demo schedule"
          : `Post ${next.toLowerCase()}`,
      );
    } catch (error) {
      toast((error as Error).message);
    }
  }
  return { ...workspace, status };
}
function PostCard({ post, edit }: { post: Post; edit: (p: Post) => void }) {
  const { data } = useWorkspace();
  return (
    <button className="content-card" onClick={() => edit(post)}>
      <div className="card-image">
        <AssetPreview
          asset={data.assets.find((a) => a.id === post.assetId)}
          variant="overview"
        />
        <span className="image-platform">
          <Platform name={post.platform} />
        </span>
      </div>
      <div className="card-body">
        <span className="card-client">
          {data.clients.find((c) => c.id === post.clientId)?.name}
        </span>
        <h3>
          {post.id === "p1"
            ? "Skincare routine for brighter skin this season ✨"
            : post.id === "p2"
              ? "A healthier smile starts here"
              : post.id === "p3"
                ? "Good coffee. Brighter days. ☀️"
                : post.title}
        </h3>
        <div className="card-meta">
          <Status value={post.status} />
          <span>
            {formatDate(post.date)} · {formatTime(post.time)}
          </span>
        </div>
      </div>
    </button>
  );
}
export function Overview({ create, edit }: ContentProps) {
  const { data, clientId, update, activity, toast } = useWorkspace();
  const [plan, setPlan] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const posts = data.posts.filter((p) => clientMatch(p.clientId, clientId));
  const leads = data.leads.filter((l) => clientMatch(l.clientId, clientId));
  const clients = data.clients.filter((c) => clientMatch(c.id, clientId));
  const pending = posts.filter((p) => p.status === "Awaiting approval");
  const metrics = [
    {
      label: "Active clients",
      value: clients.length,
      Icon: UsersRound,
      tone: "blue",
    },
    {
      label: "Awaiting approval",
      value: pending.length,
      Icon: FileText,
      tone: "amber",
    },
    {
      label: "Scheduled this week",
      value: posts.filter(
        (p) =>
          p.status === "Scheduled" &&
          p.date >= "2026-10-08" &&
          p.date <= "2026-10-14",
      ).length,
      Icon: CalendarDays,
      tone: "green",
    },
    {
      label: "New leads",
      value: leads.filter((l) => l.stage === "New").length,
      Icon: UsersRound,
      tone: "purple",
    },
  ];
  function generatePlan() {
    const id = clientId === "all" ? "bloom" : clientId;
    const client = data.clients.find((c) => c.id === id)!;
    const themes = [
      "Meet the people behind the brand",
      "A tip your audience can use today",
      "Behind the scenes",
      "Answer a common question",
      "Your weekend inspiration",
    ];
    update((prev) => ({
      ...prev,
      posts: [
        ...themes.map((title) => ({
          id: crypto.randomUUID(),
          clientId: id,
          title,
          caption: `${client.name}: ${title.toLowerCase()}. Add your client-specific details before submitting for review.`,
          platform: "Instagram",
          date: "",
          time: "09:00",
          status: "Draft" as const,
          assetId: prev.assets.find((a) => a.clientId === id)?.id || "",
          notes: [],
        })),
        ...prev.posts,
      ],
    }));
    activity("Five template-based content ideas created", id);
    toast("5 demo draft ideas added to your unscheduled content");
    setPlan(false);
  }
  const attentionClients = clients.filter((c) =>
    pending.some((p) => p.clientId === c.id),
  );
  return (
    <>
      <div className="metric-grid">
        {metrics.map(({ label, value, Icon, tone }) => (
          <div className="metric-card" key={label}>
            <div className="metric-top">
              <span>{label}</span>
              <span className={"metric-icon " + tone}>
                <Icon size={24} />
              </span>
            </div>
            <strong>{String(value).padStart(2, "0")}</strong>
            <ChevronRight size={15} className="metric-arrow" />
          </div>
        ))}
      </div>
      <div className="overview-grid">
        <div className="overview-main">
          <section className="panel">
            <div className="panel-heading">
              <h2>Needs your attention</h2>
              <Link href="/approvals" className="text-link">
                View all <ArrowRight size={16} />
              </Link>
            </div>
            {attentionClients.slice(0, 3).map((client, i) => (
              <div className="attention-row" key={client.id}>
                <ClientMark client={client} />
                <div className="attention-description">
                  <strong>{client.name}</strong>
                  <span>
                    {client.id === "northside"
                      ? "New qualified lead"
                      : client.id === "bloom"
                        ? "Instagram connection expired · sample"
                        : `${pending.filter((p) => p.clientId === client.id).length} posts ready for review`}
                  </span>
                </div>
                <div className="attention-extra">
                  {i === 0 && (
                    <div className="attention-thumbnails">
                      {[
                        "attention-palm",
                        "attention-palm-2",
                        "attention-linen",
                      ].map((name) => (
                        <img
                          key={name}
                          src={`/media/mockup/${name}.png`}
                          alt="Sample creative"
                        />
                      ))}
                    </div>
                  )}
                  <div>
                    <strong>
                      {client.id === "northside"
                        ? "Emily Carter"
                        : client.id === "bloom"
                          ? "Reconnection required · sample"
                          : `${pending.filter((p) => p.clientId === client.id).length} posts`}
                    </strong>
                    {client.id === "northside" && (
                      <span className="small-text muted">
                        Interested in social media management
                      </span>
                    )}
                    <small>
                      {client.id === "northside"
                        ? "Today 8:47 AM"
                        : client.id === "bloom"
                          ? "Yesterday 6:20 PM"
                          : "Today 9:12 AM"}
                    </small>
                  </div>
                </div>
                <Link
                  className={"button compact " + (i === 0 ? "primary" : "")}
                  href={
                    client.id === "northside"
                      ? "/leads"
                      : client.id === "bloom"
                        ? "/settings"
                        : "/approvals"
                  }
                >
                  {client.id === "northside"
                    ? "Open lead"
                    : client.id === "bloom"
                      ? "Reconnect"
                      : "Review"}
                </Link>
              </div>
            ))}
            {!attentionClients.length && (
              <Empty title="You’re all caught up">
                No content is waiting for your approval.
              </Empty>
            )}
          </section>
          <section className="panel upcoming">
            <div className="panel-heading">
              <h2>Upcoming content</h2>
              <Link className="text-link" href="/calendar">
                View calendar <ArrowRight size={16} />
              </Link>
            </div>
            <div className="content-grid">
              {posts
                .filter((p) => p.date && p.status !== "Published")
                .sort((a, b) =>
                  (a.date + a.time).localeCompare(b.date + b.time),
                )
                .slice(0, 3)
                .map((p) => (
                  <PostCard key={p.id} post={p} edit={edit} />
                ))}
            </div>
            {!posts.some((p) => p.date && p.status !== "Published") && (
              <Empty title="A fresh calendar">
                <button className="button" onClick={() => create()}>
                  Create your first post
                </button>
              </Empty>
            )}
          </section>
        </div>
        <div className="overview-side">
          <section className="panel assistant-panel">
            <div className="panel-heading">
              <h2>
                <Sparkles size={23} />
                AI assistant
              </h2>
              <Ellipsis size={18} />
            </div>
            <div className="assistant-message">
              <Bot size={25} />
              <div className="assistant-bubble">
                <strong>
                  {dismissed
                    ? "Ready when you are."
                    : "Bloom Wellness has no posts scheduled next week. Draft a 5-post plan?"}
                </strong>
                <p>
                  I can create a tailored plan with post ideas, captions and
                  relevant hashtags based on your recent content.
                </p>
                <div>
                  <button
                    className="button primary"
                    onClick={() => setPlan(true)}
                  >
                    Draft plan
                  </button>
                  <button className="button" onClick={() => setDismissed(true)}>
                    Not now
                  </button>
                </div>
                <small>Template preview · AI not connected</small>
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Recent activity</h2>
              <button
                className="text-link"
                onClick={() =>
                  document
                    .querySelector<HTMLButtonElement>(
                      '[aria-label="Recent activity"]',
                    )
                    ?.click()
                }
              >
                View all <ArrowRight size={16} />
              </button>
            </div>
            <div className="activity-list">
              {data.activities
                .filter(
                  (a) =>
                    clientId === "all" ||
                    a.clientId === clientId ||
                    a.clientId === "all",
                )
                .slice(0, 3)
                .map((a, i) => (
                  <div className="activity-row" key={a.id}>
                    <span className="activity-icon">
                      {i === 0 ? (
                        <Bot size={23} />
                      ) : i === 1 ? (
                        <CircleCheck size={23} />
                      ) : (
                        <FileText size={23} />
                      )}
                    </span>
                    <div>
                      <strong>{a.text}</strong>
                      <small>
                        {data.clients.find((c) => c.id === a.clientId)?.name ||
                          "Workspace"}
                      </small>
                    </div>
                    <span className="activity-time">
                      {["2h ago", "4h ago", "1d ago"][i]}
                    </span>
                  </div>
                ))}
            </div>
          </section>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Lead pipeline</h2>
          <Link className="text-link" href="/leads">
            View all leads <ArrowRight size={16} />
          </Link>
        </div>
        <div className="pipeline-summary">
          {(["New", "Qualified", "Contacted", "Won"] as const).map((stage) => (
            <div className={"pipeline-mini " + stage.toLowerCase()} key={stage}>
              <div className="pipeline-title">
                {stage}
                <span>{leads.filter((l) => l.stage === stage).length}</span>
              </div>
              {leads
                .filter((l) => l.stage === stage)
                .slice(0, 2)
                .map((l) => (
                  <Link className="mini-lead" key={l.id} href="/leads">
                    <ClientMark
                      small
                      client={data.clients.find((c) => c.id === l.clientId)}
                    />
                    <div>
                      <strong>{l.name}</strong>
                      <small>
                        {data.clients.find((c) => c.id === l.clientId)?.name}
                      </small>
                      <p>{l.interest}</p>
                    </div>
                    <Ellipsis size={14} />
                  </Link>
                ))}
              {!leads.some((l) => l.stage === stage) && (
                <span className="muted small-text">No leads here yet</span>
              )}
            </div>
          ))}
        </div>
      </section>
      {plan && (
        <Modal title="Draft a content plan" onClose={() => setPlan(false)}>
          <p className="muted">
            Create five editable draft ideas for{" "}
            <strong>
              {
                data.clients.find(
                  (c) => c.id === (clientId === "all" ? "bloom" : clientId),
                )?.name
              }
            </strong>
            . This uses starter templates, not a connected AI model.
          </p>
          <div className="modal-footer">
            <button className="button" onClick={() => setPlan(false)}>
              Cancel
            </button>
            <button className="button primary" onClick={generatePlan}>
              Create 5 draft ideas
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function CalendarScreen({ create, edit }: ContentProps) {
  const { data, clientId, status } = useContent();
  const [month, setMonth] = useState(new Date(2026, 9, 1));
  const [view, setView] = useState("Month");
  const [platform, setPlatform] = useState("all");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<Post | null>(null);
  const posts = data.posts.filter(
    (p) =>
      clientMatch(p.clientId, clientId) &&
      (platform === "all" || p.platform === platform) &&
      (filter === "all" || p.status === filter),
  );
  const current = selected
    ? data.posts.find((p) => p.id === selected.id)
    : undefined;
  const datePrefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  const cells = monthCells(month.getFullYear(), month.getMonth());
  const calendarPost = (p: Post) => (
    <button
      className={"calendar-post " + p.status.toLowerCase().replaceAll(" ", "-")}
      key={p.id}
      onClick={() => setSelected(p)}
    >
      <div className="calendar-post-top">
        <AssetPreview
          asset={data.assets.find((a) => a.id === p.assetId)}
          variant="calendar"
        />
        <div>
          <Platform name={p.platform} />
          <span className="calendar-client">
            {data.clients.find((c) => c.id === p.clientId)?.name}
          </span>
          <strong>{p.title}</strong>
        </div>
      </div>
      <span className="calendar-post-footer">{formatTime(p.time)}</span>
      <span className="calendar-status">
        <Status value={p.status} />
      </span>
    </button>
  );
  return (
    <>
      <div className="toolbar">
        <div className="month-controls">
          <button
            className="icon-button bordered"
            aria-label="Previous month"
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
            }
          >
            <ChevronLeft size={18} />
          </button>
          <h2>
            {month.toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            })}
          </h2>
          <button
            className="icon-button bordered"
            aria-label="Next month"
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
            }
          >
            <ChevronRight size={18} />
          </button>
          <button
            className="button compact"
            onClick={() => setMonth(new Date())}
          >
            Today
          </button>
        </div>
        <div className="toolbar-right">
          <div className="segmented">
            {["Month", "Week", "List"].map((v) => (
              <button
                className={view === v ? "selected" : ""}
                key={v}
                onClick={() => setView(v)}
              >
                {v}
              </button>
            ))}
          </div>
          <select
            aria-label="Filter platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
          >
            <option value="all">All platforms</option>
            {["Instagram", "Facebook", "LinkedIn"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select
            aria-label="Filter status"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            {[
              "Draft",
              "Awaiting approval",
              "Changes requested",
              "Scheduled",
              "Published",
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="calendar-layout">
        <section className="panel calendar-panel">
          {view !== "List" ? (
            <>
              <div className="calendar-weekdays">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="calendar-grid">
                {(view === "Week" ? cells.slice(7, 14) : cells).map(
                  (date, i) => (
                    <div
                      className={
                        "calendar-cell " +
                        (!date ? "outside" : "") +
                        (date === "2026-10-08" ? " today" : "")
                      }
                      key={date || i}
                    >
                      {date ? (
                        <>
                          <button
                            className="day-number"
                            aria-label={`Create content on ${date}`}
                            onClick={() => create(date)}
                          >
                            {Number(date.slice(-2))}
                          </button>
                          {posts
                            .filter((p) => p.date === date)
                            .sort((a, b) => a.time.localeCompare(b.time))
                            .map(calendarPost)}
                        </>
                      ) : (
                        <span className="day-number muted">
                          {i < 3 ? 28 + i : 1}
                        </span>
                      )}
                    </div>
                  ),
                )}
              </div>
            </>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Content</th>
                    <th>Client</th>
                    <th>Platform</th>
                    <th>Schedule</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {posts
                    .filter((p) => p.date.startsWith(datePrefix))
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((p) => (
                      <tr key={p.id} onClick={() => setSelected(p)}>
                        <td>
                          <button className="table-link">{p.title}</button>
                        </td>
                        <td>
                          {data.clients.find((c) => c.id === p.clientId)?.name}
                        </td>
                        <td>
                          <Platform name={p.platform} />
                        </td>
                        <td>
                          {formatDate(p.date)} · {formatTime(p.time)}
                        </td>
                        <td>
                          <Status value={p.status} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!posts.some((p) => p.date.startsWith(datePrefix)) && (
                <Empty title="No content this month">
                  Choose another month or create a new draft.
                </Empty>
              )}
            </div>
          )}
        </section>
        <aside className="panel ideas-panel">
          <div className="panel-heading">
            <h2>Unscheduled ideas</h2>
          </div>
          <p className="muted small-text">Timezone: Asia/Singapore</p>
          {posts
            .filter((p) => !p.date)
            .sort((a, b) =>
              a.clientId === "coastal" ? -1 : b.clientId === "coastal" ? 1 : 0,
            )
            .map((p) => (
              <button className="idea-card" key={p.id} onClick={() => edit(p)}>
                <AssetPreview
                  asset={data.assets.find((a) => a.id === p.assetId)}
                />
                <div>
                  <small>
                    <Platform name={p.platform} />{" "}
                    {data.clients.find((c) => c.id === p.clientId)?.name}
                  </small>
                  <strong>{p.title}</strong>
                </div>
              </button>
            ))}
          {!posts.some((p) => !p.date) && <Empty title="Room for a new idea" />}
          <button className="button full" onClick={() => create()}>
            + Add an idea
          </button>
        </aside>
      </div>
      {current && (
        <Modal title="Content details" onClose={() => setSelected(null)} wide>
          <div className="post-detail">
            <AssetPreview
              asset={data.assets.find((a) => a.id === current.assetId)}
              variant="approval"
            />
            <div>
              <ClientMark
                small
                client={data.clients.find((c) => c.id === current.clientId)}
              />
              <h3>{current.title}</h3>
              <Platform name={current.platform} />
              <p>{current.caption}</p>
              <p className="muted">
                {formatDate(current.date)} · {formatTime(current.time)}
              </p>
              <Status value={current.status} />
            </div>
          </div>
          <div className="modal-footer">
            <button className="button" onClick={() => setSelected(null)}>
              Close
            </button>
            {current.status !== "Published" && (
              <button
                className="button"
                onClick={() => {
                  edit(current);
                  setSelected(null);
                }}
              >
                <Pencil size={15} />
                Edit draft
              </button>
            )}
            {(current.status === "Draft" ||
              current.status === "Changes requested") && (
              <button
                className="button primary"
                onClick={() => {
                  status(current, "Awaiting approval");
                  setSelected(null);
                }}
              >
                <Send size={15} />
                Submit for approval
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
export function Approvals({ edit }: { edit: (p: Post) => void }) {
  const {
    data,
    clientId,
    setClientId,
    update,
    status,
    activity,
    toast,
    session,
    cloud,
  } = useContent();
  const [tab, setTab] = useState("Pending");
  const [platform, setPlatform] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [feedback, setFeedback] = useState("");
  const expected =
    tab === "Pending"
      ? "Awaiting approval"
      : tab === "Approved"
        ? "Scheduled"
        : "Changes requested";
  const posts = data.posts
    .filter(
      (p) =>
        clientMatch(p.clientId, clientId) &&
        p.status === expected &&
        (platform === "all" || p.platform === platform),
    )
    .sort((a, b) =>
      a.id === "p3" ? -1 : b.id === "p3" ? 1 : a.date.localeCompare(b.date),
    );
  const selected = posts.find((p) => p.id === selectedId) || posts[0];
  function addFeedback(requestChanges = false) {
    if (!selected) return;
    if (!feedback.trim()) {
      toast("Add feedback before requesting changes.");
      return;
    }
    const note = { text: feedback.trim(), date: new Date().toISOString() };
    update((prev) => ({
      ...prev,
      posts: prev.posts.map((p) =>
        p.id === selected.id
          ? {
              ...p,
              notes: [...p.notes, note],
              status: requestChanges ? "Changes requested" : p.status,
            }
          : p,
      ),
    }));
    activity(
      requestChanges
        ? "Changes requested on content"
        : "Feedback added to content",
      selected.clientId,
    );
    toast(requestChanges ? "Feedback sent to the draft" : "Feedback added");
    setFeedback("");
  }
  const demoNotes = [
    [
      "Jamie Park",
      "Oct 8, 2026 · 2:14 PM",
      "Here’s the updated caption with a shorter, punchier line. Let me know if you’d like any tweaks!",
      "jamie-avatar",
    ],
    [
      "Sam Lee",
      "Oct 9, 2026 · 10:27 AM",
      "Looks great! Could we try one version with a location tag as well? Otherwise I’m happy to approve.",
      "reviewer-avatar",
    ],
    [
      "Jamie Park",
      "Oct 9, 2026 · 1:03 PM",
      "Sure thing — I’ve added a version with the location tag in v2.",
      "jamie-avatar",
    ],
  ];
  return (
    <>
      <div className="toolbar">
        <div className="approval-filters">
          <select
            aria-label="Approval client"
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
            aria-label="Approval platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
          >
            <option value="all">All platforms</option>
            {["Instagram", "Facebook", "LinkedIn"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="segmented">
          {["Pending", "Approved", "Changes requested"].map((t) => (
            <button
              className={tab === t ? "selected" : ""}
              key={t}
              onClick={() => {
                setTab(t);
                setSelectedId("");
                setFeedback("");
              }}
            >
              {t}
              <span>
                {
                  data.posts.filter(
                    (p) =>
                      clientMatch(p.clientId, clientId) &&
                      p.status ===
                        (t === "Pending"
                          ? "Awaiting approval"
                          : t === "Approved"
                            ? "Scheduled"
                            : "Changes requested"),
                  ).length
                }
              </span>
            </button>
          ))}
        </div>
      </div>
      {selected ? (
        <div className="approval-layout">
          <aside className="approval-queue">
            {posts.map((p) => (
              <button
                className={
                  "approval-item " + (selected.id === p.id ? "selected" : "")
                }
                key={p.id}
                onClick={() => {
                  setSelectedId(p.id);
                  setFeedback("");
                }}
              >
                <AssetPreview
                  asset={data.assets.find((a) => a.id === p.assetId)}
                  variant="approval"
                />
                <div>
                  <strong>
                    {data.clients.find((c) => c.id === p.clientId)?.name}
                  </strong>
                  <Platform name={p.platform} />
                  <span>{p.title}</span>
                  <small>
                    {formatDate(p.date)} · {formatTime(p.time)}
                  </small>
                </div>
              </button>
            ))}
          </aside>
          <section className="panel approval-detail">
            <div className="approval-detail-header">
              <ClientMark
                client={data.clients.find((c) => c.id === selected.clientId)}
              />
              <div>
                <h2>
                  {data.clients.find((c) => c.id === selected.clientId)?.name}
                </h2>
                <Platform name={selected.platform} />
              </div>
              <div className="approval-submission">
                <Badge>Version 2</Badge>
                <div>
                  Submitted by Jamie Park
                  <small>Oct 8, 2026 · 2:14 PM · Sample</small>
                </div>
                <img src="/media/mockup/jamie-avatar.png" alt="" />
              </div>
            </div>
            <div className="approval-review">
              <div className="social-preview">
                <AssetPreview
                  asset={data.assets.find((a) => a.id === selected.assetId)}
                  variant="approval"
                />
              </div>
              <div className="review-content">
                <h3>Post caption</h3>
                <p className="caption-box">{selected.caption}</p>
                <h3>Tags</h3>
                <div className="review-tags">
                  {[
                    "#coastalstudio",
                    "#coffee",
                    "#coastlife",
                    "#weekendvibes",
                  ].map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                <h3>Publishing date</h3>
                <div className="schedule-detail">
                  <CalendarClock size={22} />
                  {formatDate(selected.date)} · {formatTime(selected.time)}
                </div>
                <h3 className="review-notes-title">Review notes</h3>
                {!cloud &&
                  selected.id === "p3" &&
                  demoNotes.map(([name, date, text, avatar], i) => (
                    <div className="review-note" key={i}>
                      <img src={`/media/mockup/${avatar}.png`} alt="" />
                      <div>
                        <strong>{name}</strong>
                        <small>{date} · Sample</small>
                        <p>{text}</p>
                      </div>
                    </div>
                  ))}
                {selected.notes.map((n, i) => (
                  <div className="review-note" key={i}>
                    <img src="/media/mockup/reviewer-avatar.png" alt="" />
                    <div>
                      <strong>
                        {cloud ? "Workspace feedback" : "Sam Lee"}
                      </strong>
                      <small>{new Date(n.date).toLocaleString()}</small>
                      <p>{n.text}</p>
                    </div>
                  </div>
                ))}
                {(cloud || selected.id !== "p3") && !selected.notes.length && (
                  <p className="muted small-text">
                    No feedback yet. Leave a note for your team.
                  </p>
                )}
              </div>
            </div>
            <div className="feedback-row">
              <img src="/media/mockup/reviewer-avatar.png" alt="" />
              <Field label="Add feedback">
                <textarea
                  rows={1}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Add feedback…"
                />
              </Field>
              {feedback.trim() && (
                <button
                  className="button compact"
                  onClick={() => addFeedback()}
                >
                  Add note
                </button>
              )}
            </div>
            <div className="approval-footer">
              <button
                className="button"
                disabled={session?.role === "client_reviewer"}
                onClick={() => edit(selected)}
              >
                <Pencil size={15} />
                Edit content
              </button>
              <div>
                {tab === "Pending" &&
                  (!cloud || session?.role !== "team_member") && (
                    <>
                      <button
                        className="button"
                        onClick={() => addFeedback(true)}
                      >
                        Request changes
                      </button>
                      <button
                        className="button primary"
                        onClick={() => status(selected, "Scheduled")}
                      >
                        Approve & schedule
                      </button>
                    </>
                  )}
                {tab === "Changes requested" &&
                  session?.role !== "client_reviewer" && (
                    <button
                      className="button primary"
                      onClick={() => status(selected, "Awaiting approval")}
                    >
                      Resubmit for approval
                    </button>
                  )}
              </div>
            </div>
          </section>
        </div>
      ) : (
        <section className="panel">
          <Empty
            title={tab === "Pending" ? "All caught up!" : "Nothing here yet"}
          >
            Content with this status will appear here.
          </Empty>
        </section>
      )}
    </>
  );
}
