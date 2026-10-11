"use client";
import { useState } from "react";
import { useWorkspace } from "./workspace-provider";
import { cloudRequest } from "@/lib/cloud";
import type { Client } from "@/lib/types";
import { AccountMenu } from "./account-menu";
export function ImportBrowserRecords() {
  const { session, refresh, toast } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{
    clients: number;
    posts: number;
    leads: number;
  } | null>(null);
  return (
    <div>
      <h3>Import This Browser’s Demo Records</h3>
      <p>
        Import into an empty workspace. Posts become drafts; previous approvals,
        simulated activity and agency-wide demo workflows are excluded.
        Browser-only uploads stay in this browser. Your original browser records
        are preserved.
      </p>
      {!review ? (
        <button
          onClick={() => {
            try {
              const raw = localStorage.getItem("grailhiiv.workspace.v1");
              if (!raw) throw new Error("No browser records were found.");
              const data = JSON.parse(raw);
              setReview({
                clients: data.clients.length,
                posts: data.posts.length,
                leads: data.leads.length,
              });
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        >
          Review Import
        </button>
      ) : (
        <>
          <p>
            {review.clients} clients · {review.posts} posts · {review.leads}{" "}
            leads
          </p>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const data = JSON.parse(
                  localStorage.getItem("grailhiiv.workspace.v1") || "null",
                );
                const result = await cloudRequest<{
                  imported: number;
                  skippedFiles: number;
                }>("/api/import", { workspaceId: session?.workspaceId, data });
                await refresh();
                toast(
                  `Imported ${result.imported} records. ${result.skippedFiles} browser-only files excluded.`,
                );
              } catch (e) {
                toast((e as Error).message);
              } finally {
                setBusy(false);
                setReview(null);
              }
            }}
          >
            {busy ? "Importing…" : "Confirm Import"}
          </button>
          <button disabled={busy} onClick={() => setReview(null)}>
            Cancel
          </button>
        </>
      )}
    </div>
  );
}
export function EmptyCloudWorkspace() {
  const {
    session,
    update,
    storageError,
    notice,
    workspaces,
    switchWorkspace,
    saving,
  } = useWorkspace();
  return (
    <main className="auth-page">
      <header className="empty-account-header">
        {workspaces.length > 1 && (
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
        )}
        <AccountMenu />
      </header>
      <section className="auth-card">
        <h1>
          {session?.role === "owner"
            ? "Create Your First Client"
            : "No Clients Assigned"}
        </h1>
        {session?.role === "owner" ? (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const name = String(
                  new FormData(e.currentTarget).get("name"),
                ).trim();
                const client: Client = {
                  id: crypto.randomUUID(),
                  name,
                  initials: name.slice(0, 2).toUpperCase(),
                  color: "#d9eaf0",
                  website: "",
                  contact: "",
                  email: "",
                  timezone: "Asia/Singapore",
                  voice: "",
                  audience: "",
                  approvalRequired: true,
                };
                update((prev) => ({ ...prev, clients: [client] }));
              }}
            >
              <label>
                Client Name
                <input name="name" required maxLength={200} />
              </label>
              <button className="primary-button">Create Client</button>
            </form>
            <ImportBrowserRecords />
          </>
        ) : (
          <p>Ask the workspace owner to assign your client access.</p>
        )}
        {storageError && <p role="alert">{storageError}</p>}
        <p role="status">{notice}</p>
      </section>
    </main>
  );
}
