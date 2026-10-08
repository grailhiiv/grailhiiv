"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { createSeed } from "@/lib/data";
import { applyMockupMedia } from "@/lib/mockup-media";
import { isWorkspace } from "@/lib/domain";
import type { Workspace } from "@/lib/types";
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
};
const WorkspaceContext = createContext<Context | null>(null);
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Workspace>(createSeed);
  const [clientId, setClient] = useState("all");
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [storageError, setStorageError] = useState("");
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isWorkspace(parsed)) setData(applyMockupMedia(parsed));
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
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      if (!storageError) localStorage.setItem(storageKey, JSON.stringify(data));
    } catch {
      setStorageError(
        "Your browser could not save these changes. Export your workspace from Settings.",
      );
    }
  }, [data, ready, storageError]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const update = useCallback(
    (fn: (prev: Workspace) => Workspace) => setData(fn),
    [],
  );
  const toast = useCallback((message: string) => setNotice(message), []);
  const activity = useCallback(
    (text: string, id = "all") =>
      setData((prev) => ({
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
      })),
    [],
  );
  function setClientId(id: string) {
    setClient(id);
    try {
      localStorage.setItem("grailhiiv.client", id);
    } catch {
      toast("Client selection could not be saved.");
    }
  }
  return (
    <WorkspaceContext.Provider
      value={{
        data,
        update,
        clientId,
        setClientId,
        ready,
        toast,
        activity,
        notice,
        storageError,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("GrailHiiv workspace provider is missing.");
  return context;
}
