"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  House,
  CalendarDays,
  CircleCheck,
  UsersRound,
  Workflow,
  Images,
  ChartNoAxesCombined,
  Settings2,
  Bell,
  ChevronDown,
  Menu,
  X,
  Hexagon,
  ArrowUpRight,
} from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Modal, ClientMark } from "./ui";
const nav = [
  ["/", "Overview", House],
  ["/calendar", "Content calendar", CalendarDays],
  ["/approvals", "Approvals", CircleCheck],
  ["/leads", "Leads & CRM", UsersRound],
  ["/automations", "Automations", Workflow],
  ["/assets", "Asset library", Images],
  ["/reports", "Reports", ChartNoAxesCombined],
  ["/settings", "Settings", Settings2],
] as const;
export function Shell({ children }: { children: React.ReactNode }) {
  const {
    data,
    clientId,
    setClientId,
    ready,
    notice,
    storageError,
    session,
    cloud,
  } = useWorkspace();
  const pathname = usePathname();
  const [mobile, setMobile] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const pending = data.posts.filter(
    (p) =>
      p.status === "Awaiting approval" &&
      (clientId === "all" || p.clientId === clientId),
  ).length;
  const selected = data.clients.find((c) => c.id === clientId);
  if (!ready)
    return (
      <div className="loading">
        <Hexagon size={38} />
        <strong>GrailHiiv</strong>
        <span>Opening your workspace…</span>
      </div>
    );
  return (
    <div className={"app " + (pathname === "/" ? "is-overview" : "")}>
      <aside className={"sidebar " + (mobile ? "open" : "")}>
        <Link href="/" className="brand" onClick={() => setMobile(false)}>
          <span className="brand-icon">
            <Hexagon size={27} />
            <span />
          </span>
          <span>GrailHiiv</span>
        </Link>
        <button
          aria-label="Close navigation"
          className="icon-button mobile-close"
          onClick={() => setMobile(false)}
        >
          <X />
        </button>
        <div className="client-selector">
          <UsersRound size={17} />
          <select
            aria-label="Selected client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="all">All clients</option>
            {data.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
        <nav aria-label="Main navigation">
          {nav
            .filter(
              ([href]) =>
                session?.role !== "client_reviewer" ||
                ["/", "/approvals", "/assets"].includes(href),
            )
            .map(([href, label, Icon]) => (
              <Link
                key={href}
                className={"nav-item " + (pathname === href ? "active" : "")}
                href={href}
                onClick={() => setMobile(false)}
                aria-current={pathname === href ? "page" : undefined}
              >
                <Icon size={22} />
                <span>{label}</span>
                {href === "/approvals" && pending > 0 && (
                  <span className="nav-count">{pending}</span>
                )}
              </Link>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-plan">
            <span className="status-dot" />
            <div>
              <strong>{cloud ? "Shared workspace" : "Local demo"}</strong>
              <small>
                {cloud ? "Saved in Supabase" : "Saved in this browser"}
              </small>
            </div>
          </div>
          <Link href="/settings" className="setup-link">
            Set up your workspace <ArrowUpRight size={15} />
          </Link>
        </div>
      </aside>
      {mobile && (
        <button
          className="nav-overlay"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu />
            </button>
          </div>
          <div className="top-actions">
            {pathname === "/" && (
              <span className="top-date">
                <CalendarDays size={18} />
                October 8, 2026
              </span>
            )}
            <button
              className="icon-button notification"
              aria-label="Recent activity"
              onClick={() => setNotifications(true)}
            >
              <Bell size={22} />
              {data.preferences.notifications && <i />}
            </button>
            <span className="top-divider" />
            <Link className="profile" href="/settings">
              <img
                className="avatar"
                src="/media/mockup/sam-avatar.png"
                alt=""
              />
              <span>{session?.email || "Sam Lee"}</span>
              <ChevronDown size={14} />
            </Link>
          </div>
        </header>
        {storageError && (
          <div className="storage-warning" role="alert">
            {storageError}
          </div>
        )}
        <main>{children}</main>
        <footer className="app-footer">
          <span>
            GrailHiiv · {cloud ? data.preferences.name : "Sample workspace"}
          </span>
          <span>
            {cloud
              ? "Shared workspace · AI and publishing not connected"
              : "Local demo · No external accounts connected"}
          </span>
        </footer>
      </div>
      {notice && (
        <div className="toast" role="status">
          <CircleCheck size={18} />
          {notice}
        </div>
      )}
      {notifications && (
        <Modal title="Recent activity" onClose={() => setNotifications(false)}>
          <div className="activity-list">
            {data.activities
              .filter(
                (a) =>
                  clientId === "all" ||
                  a.clientId === clientId ||
                  a.clientId === "all",
              )
              .slice(0, 12)
              .map((a) => (
                <div className="activity-row" key={a.id}>
                  <CircleCheck size={18} />
                  <div>
                    <strong>{a.text}</strong>
                    <small>
                      {data.clients.find((c) => c.id === a.clientId)?.name ||
                        "Workspace"}{" "}
                      · {new Date(a.date).toLocaleString()}
                    </small>
                  </div>
                </div>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
