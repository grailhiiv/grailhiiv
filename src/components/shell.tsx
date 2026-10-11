"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import { useWorkspace } from "./workspace-provider";
import { Modal, ClientMark } from "./ui";
import { AccountMenu } from "./account-menu";
const nav = [
  ["/", "Overview", House],
  ["/calendar", "Content Calendar", CalendarDays],
  ["/approvals", "Approvals", CircleCheck],
  ["/leads", "Leads & CRM", UsersRound],
  ["/automations", "Automations", Workflow],
  ["/assets", "Asset Library", Images],
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
    workspaces,
    switchWorkspace,
    saving,
  } = useWorkspace();
  const pathname = usePathname();
  const [mobile, setMobile] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const navigationTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!mobile) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const controls = () => [...(sidebar.current?.querySelectorAll<HTMLElement>('a[href],button,select') || [])].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
    const focusFrame = requestAnimationFrame(() => sidebar.current?.querySelector<HTMLElement>(".mobile-close")?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobile(false);
      if (event.key !== "Tab") return;
      const items = controls();
      const target = event.shiftKey ? items.at(-1) : items[0];
      if (document.activeElement === (event.shiftKey ? items[0] : items.at(-1))) {
        event.preventDefault();
        target?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keydown);
      navigationTrigger.current?.focus();
    };
  }, [mobile]);
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
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside
        ref={sidebar}
        className={"sidebar " + (mobile ? "open" : "")}
        onTransitionEnd={(event) => {
          if (mobile && event.target === event.currentTarget && event.propertyName === "transform")
            sidebar.current?.querySelector<HTMLElement>(".mobile-close")?.focus();
        }}
      >
        <Link href="/" className="brand" onClick={() => setMobile(false)}>
          <span className="brand-icon">
            <Hexagon size={27} />
            <span />
          </span>
          <span>GrailHiiv</span>
        </Link>
        <button
          aria-label="Close Navigation"
          className="icon-button mobile-close"
          onClick={() => setMobile(false)}
        >
          <X />
        </button>
        <div className="client-selector">
          <UsersRound size={17} />
          <select
            aria-label="Selected Client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="all">All Clients</option>
            {data.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
        <nav aria-label="Main Navigation">
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
        {workspaces.length > 1 && (
          <div className="sidebar-bottom">
            <select
              className="workspace-selector"
              aria-label="Workspace"
              value={session?.workspaceId}
              disabled={saving}
              onChange={(event) => switchWorkspace(event.target.value)}
            >
              {workspaces.map((workspace) => (
                <option
                  key={workspace.workspace_id}
                  value={workspace.workspace_id}
                >
                  {workspace.workspace_id} ({workspace.role})
                </option>
              ))}
            </select>
          </div>
        )}
      </aside>
      {mobile && (
        <button
          className="nav-overlay"
          aria-label="Close Navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main-shell" inert={mobile || undefined}>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              ref={navigationTrigger}
              aria-label="Open Navigation"
              aria-expanded={mobile}
              onClick={() => setMobile(true)}
            >
              <Menu />
            </button>
          </div>
          <div className="top-actions">
            {pathname === "/" && (
              <span className="top-date">
                <CalendarDays size={18} />
                {new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date())}
              </span>
            )}
            <button
              className="icon-button notification"
              aria-label="Recent Activity"
              onClick={() => setNotifications(true)}
            >
              <Bell size={22} />
              {data.preferences.notifications && <i />}
            </button>
            <span className="top-divider" />
            <AccountMenu />
          </div>
        </header>
        {storageError && (
          <div className="storage-warning" role="alert">
            {storageError}
          </div>
        )}
        <main id="main-content" tabIndex={-1}>{children}</main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <CircleCheck size={18} />
          {notice}
        </div>
      )}
      {notifications && (
        <Modal title="Recent Activity" onClose={() => setNotifications(false)}>
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
