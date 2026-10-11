"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { usePathname } from "next/navigation";
import { createSeed } from "@/lib/data";
import { applyMockupMedia } from "@/lib/mockup-media";
import { isWorkspace } from "@/lib/domain";
import {
  cloudRequest,
  diffWorkspace,
  emptyWorkspace,
  type CloudSession,
} from "@/lib/cloud";
import type { Workspace } from "@/lib/types";
import { AuthPanel, WorkspaceOnboarding } from "./auth-panel";
import { EmptyCloudWorkspace } from "./cloud-controls";
const storageKey = "grailhiiv.workspace.v1";
type Context = {
  data: Workspace;
  update: (fn: (prev: Workspace) => Workspace) => void;
  clientId: string;
  setClientId: (id: string) => void;
  ready: boolean;
  toast: (message: string) => void;
  activity: (text: string, clientId?: string) => void;
  notice: string;
  storageError: string;
  saving: boolean;
  session: CloudSession | null;
  cloud: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  workspaces: { workspace_id: string; role: string }[];
  switchWorkspace: (id: string) => void;
};
type Remote = {
  data?: Workspace;
  session: CloudSession | null;
  email?: string;
  workspaces: { workspace_id: string; role: string }[];
};
const WorkspaceContext = createContext<Context | null>(null);
export function WorkspaceProvider({
  children,
  mode = "demo",
  demoLogoutUrl = "/login",
}: {
  children: React.ReactNode;
  mode?: "demo" | "cloud" | "setup";
  demoLogoutUrl?: string;
}) {
  const cloud = mode === "cloud";
  const pathname = usePathname();
  const [data, setData] = useState<Workspace>(() =>
    cloud ? emptyWorkspace() : createSeed(),
  );
  const dataRef = useRef(data);
  const [session, setSession] = useState<CloudSession | null>(null);
  const sessionRef = useRef<CloudSession | null>(null);
  const [workspaces, setWorkspaces] = useState<Remote["workspaces"]>([]);
  const [email, setEmail] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const [clientId, setClient] = useState("all");
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [storageError, setStorageError] = useState("");
  const [pending, setPending] = useState(0);
  const count = useRef(0);
  const generation = useRef(0);
  const queue = useRef(Promise.resolve());
  const loading = useRef(false);
  const mutationVersion = useRef(0);
  const failedSave = useRef(false);
  const replace = useCallback((next: Workspace) => {
    dataRef.current = next;
    setData(next);
  }, []);
  const refresh = useCallback(
    async function refreshWorkspace(wid?: string, automatic = false) {
      if (
        !cloud ||
        loading.current ||
        count.current ||
        (automatic && failedSave.current)
      )
        return;
      loading.current = true;
      const version = mutationVersion.current;
      let retry = false;
      try {
        const id = wid || sessionRef.current?.workspaceId;
        const result = await cloudRequest<Remote>(
          "/api/workspace" + (id ? "?workspaceId=" + id : ""),
        );
        if (count.current || version !== mutationVersion.current) {
          retry = true;
          return;
        }
        setSession(result.session);
        sessionRef.current = result.session;
        setSignedOut(false);
        setEmail(result.email || result.session?.email || "");
        setWorkspaces(result.workspaces);
        replace(result.data || emptyWorkspace());
        failedSave.current = false;
        setStorageError("");
        setReady(true);
      } catch (e) {
        const message = (e as Error).message;
        if (message === "Sign in to continue.") {
          setSignedOut(true);
          setSession(null);
          sessionRef.current = null;
          replace(emptyWorkspace());
        } else setStorageError(message);
        setReady(true);
      } finally {
        loading.current = false;
        if (retry && !count.current) void refreshWorkspace(wid, true);
      }
    },
    [cloud, replace],
  );
  useEffect(() => {
    if (cloud) {
      void refresh();
      return;
    }
    if (mode === "setup") {
      setReady(true);
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isWorkspace(parsed)) replace(applyMockupMedia(parsed));
        else
          setStorageError(
            "Saved data could not be loaded. Export your data before resetting this browser.",
          );
      }
      const id = localStorage.getItem("grailhiiv.client");
      if (id) setClient(id);
    } catch {
      setStorageError(
        "Browser storage is unavailable. Changes may not survive a reload.",
      );
    }
    setReady(true);
  }, [cloud, mode, refresh, replace]);
  useEffect(() => {
    if (cloud || mode !== "demo" || !ready || storageError) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(data));
    } catch {
      setStorageError(
        "Your browser could not save these changes. Export your workspace from Settings.",
      );
    }
  }, [cloud, mode, data, ready, storageError]);
  useEffect(() => {
    if (!cloud) return;
    const timer = setInterval(() => void refresh(undefined, true), 15000);
    const focus = () => void refresh(undefined, true);
    const leaving = (e: BeforeUnloadEvent) => {
      if (count.current || failedSave.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("focus", focus);
    window.addEventListener("beforeunload", leaving);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      window.removeEventListener("beforeunload", leaving);
    };
  }, [cloud, refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const toast = useCallback((message: string) => setNotice(message), []);
  const update = useCallback(
    (fn: (prev: Workspace) => Workspace) => {
      const before = dataRef.current;
      const next = fn(before);
      if (!cloud) {
        replace(next);
        return;
      }
      const current = sessionRef.current;
      if (!current || storageError || failedSave.current) {
        toast("Reload your workspace before making more changes.");
        return;
      }
      const changes = diffWorkspace(before, next);
      if (
        current.role !== "owner" &&
        changes.some((c) => c.kind === "clients")
      ) {
        toast("Only owners can edit clients.");
        return;
      }
      if (
        current.role === "client_reviewer" &&
        changes.some((c) => c.kind !== "posts")
      ) {
        toast("Reviewers can only approve posts or leave feedback.");
        return;
      }
      const preferences =
        JSON.stringify(before.preferences) !== JSON.stringify(next.preferences)
          ? next.preferences
          : undefined;
      if (!changes.length && !preferences) return;
      mutationVersion.current++;
      replace(next);
      const token = generation.current;
      count.current++;
      setPending(count.current);
      queue.current = queue.current
        .then(async () => {
          if (token !== generation.current) return;
          try {
            await cloudRequest("/api/workspace", {
              workspaceId: current.workspaceId,
              changes,
              preferences,
            });
          } catch (e) {
            generation.current++;
            failedSave.current = true;
            setStorageError("Changes were not saved: " + (e as Error).message);
            toast(
              "Changes were not saved. Reload to restore the shared records.",
            );
          }
        })
        .finally(() => {
          count.current--;
          setPending(count.current);
          if (count.current === 0 && token === generation.current)
            void refresh(undefined, true);
        });
    },
    [cloud, replace, refresh, storageError, toast],
  );
  const activity = useCallback(
    (text: string, id = "all") => {
      if (cloud) return;
      update((prev) => ({
        ...prev,
        activities: [
          {
            id: crypto.randomUUID(),
            text,
            clientId: id,
            date: new Date().toISOString(),
          },
          ...prev.activities,
        ].slice(0, 100),
      }));
    },
    [cloud, update],
  );
  function setClientId(id: string) {
    setClient(id);
    if (!cloud)
      try {
        localStorage.setItem("grailhiiv.client", id);
      } catch {
        toast("Client selection could not be saved.");
      }
  }
  const value: Context = {
    data,
    update,
    clientId,
    setClientId,
    ready,
    toast,
    activity,
    notice,
    storageError,
    saving: pending > 0,
    session,
    cloud,
    refresh: cloud ? refresh : async () => window.location.reload(),
    logout: async () => {
      if (cloud) await cloudRequest("/api/auth", { action: "logout" });
      window.location.assign(cloud ? "/login" : demoLogoutUrl);
    },
    workspaces,
    switchWorkspace: (id) => {
      setClient("all");
      void refresh(id);
    },
  };
  if (mode === "setup")
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Connect GrailHiiv</h1>
          <p>
            Configure Supabase in .env.local and apply the database migrations.
            For a local sample workspace, explicitly enable
            GRAILHIIV_DEMO_MODE=true.
          </p>
        </section>
      </main>
    );
  if (cloud && pathname === "/auth/password") return <AuthPanel password />;
  if (cloud && (signedOut || pathname === "/login")) return <AuthPanel />;
  if (cloud && ready && !session && !storageError)
    return (
      <WorkspaceOnboarding email={email} onCreated={(id) => void refresh(id)} />
    );
  if (cloud && ready && !session && storageError)
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>Workspace Unavailable</h1>
          <p role="alert">{storageError}</p>
          <button onClick={() => void refresh()}>Try Again</button>
          <button
            onClick={async () => {
              await cloudRequest("/api/auth", { action: "logout" });
              window.location.assign("/login");
            }}
          >
            Sign Out
          </button>
        </section>
      </main>
    );
  return (
    <WorkspaceContext.Provider value={value}>
      {cloud &&
      ready &&
      session &&
      !data.clients.length &&
      pathname !== "/settings" ? (
        <EmptyCloudWorkspace />
      ) : (
        children
      )}
    </WorkspaceContext.Provider>
  );
}
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("GrailHiiv workspace provider is missing.");
  return context;
}
