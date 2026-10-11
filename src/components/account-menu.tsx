"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, RefreshCw, Settings2 } from "lucide-react";
import { useWorkspace } from "./workspace-provider";

export function AccountMenu() {
  const { session, saving, refresh, logout, toast, cloud } = useWorkspace();
  const menu = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const identity = session?.email || (cloud ? "Account" : "Sam Lee");
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node))
        menu.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      if (menu.current) menu.current.open = false;
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-controls">
      {saving && (
        <span className="account-saving" role="status">
          Saving…
        </span>
      )}
      <details
        ref={menu}
        className="account-menu"
        onKeyDown={(event) => {
          if (event.key === "Escape" && menu.current?.open) {
            event.preventDefault();
            menu.current.open = false;
            menu.current.querySelector("summary")?.focus();
          }
        }}
      >
        <summary className="profile" aria-label="Account Menu" title={identity}>
          {cloud ? <span className="avatar account-initial" aria-hidden="true">{identity.slice(0, 1).toUpperCase()}</span> : <img className="avatar" src="/media/mockup/sam-avatar.png" alt="" />}
          <span>{identity}</span>
          <ChevronDown size={14} />
        </summary>
        <div className="account-dropdown" aria-label="Account Actions">
          <Link
            href="/settings"
            onClick={() => {
              if (menu.current) menu.current.open = false;
            }}
          >
            <Settings2 size={17} /> Settings
          </Link>
          <button disabled={saving || busy} onClick={() => void run(refresh)}>
            <RefreshCw size={17} /> Refresh
          </button>
          <button disabled={saving || busy} onClick={() => void run(logout)}>
            <LogOut size={17} /> Logout
          </button>
        </div>
      </details>
    </div>
  );
}
