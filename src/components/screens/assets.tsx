"use client";
import { useState } from "react";
import {
  Search,
  FolderOpen,
  Download,
  ImagePlus,
  Check,
  FileImage,
  Grid2X2,
  List,
} from "lucide-react";
import { useWorkspace } from "../workspace-provider";
import { AssetPreview, DetailsPanel, Empty, Field, Modal, Status } from "../ui";
import { loadFile, saveFile } from "@/lib/assets";
import { clientMatch } from "@/lib/domain";
import type { Asset } from "@/lib/types";
import { titleLabel } from "@/lib/labels";
export function AssetsScreen({
  createFromAsset,
}: {
  createFromAsset: (asset: Asset) => void;
}) {
  const {
    data,
    clientId,
    setClientId,
    update,
    toast,
    activity,
    cloud,
    session,
    refresh,
  } = useWorkspace();
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All assets");
  const [type, setType] = useState("all");
  const [view, setView] = useState("Grid");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadClient, setUploadClient] = useState(
    clientId === "all" ? data.clients[0]?.id || "" : clientId,
  );
  const [busy, setBusy] = useState(false);
  const assets = data.assets.filter(
    (a) =>
      clientMatch(a.clientId, clientId) &&
      `${a.name} ${a.tags.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter !== "Approved assets" || a.status === "Approved") &&
      filter !== "Archived" &&
      (filter !== "Campaigns" ||
        a.tags.includes("Campaign") ||
        a.tags.includes("October campaign")) &&
      (type === "all" || a.type.startsWith(type)) &&
      (filter !== "Brand kits" || a.tags.includes("Brand kit")),
  );
  const selected = assets.find((a) => a.id === selectedId);
  async function upload() {
    setBusy(true);
    try {
      if (cloud) {
        if (!session) throw new Error("Sign in to upload assets.");
        for (const file of pendingFiles) {
          const form = new FormData();
          form.set("workspaceId", session.workspaceId);
          form.set("clientId", uploadClient);
          form.set("file", file);
          const response = await fetch("/api/assets", {
            method: "POST",
            body: form,
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
        }
        await refresh();
        setPendingFiles([]);
        toast("Assets saved to private Supabase Storage");
        return;
      }
      const records: Asset[] = [];
      for (const file of pendingFiles) {
        if (file.size > 10 * 1024 * 1024)
          throw new Error(`${file.name} exceeds the 10 MB demo upload limit.`);
        if (
          !file.type.startsWith("image/") &&
          !file.type.startsWith("video/") &&
          file.type !== "application/pdf"
        )
          throw new Error("Upload an image, video or PDF.");
        if (file.type === "image/svg+xml")
          throw new Error("Use PNG, JPG or WebP for uploaded images.");
        const id = crypto.randomUUID();
        await saveFile(id, file);
        records.push({
          id,
          clientId: uploadClient,
          name: file.name,
          type: file.type,
          size: file.size,
          url: "",
          status: "Draft",
          tags: [],
          uploaded: true,
        });
      }
      update((prev) => ({ ...prev, assets: [...records, ...prev.assets] }));
      setSelectedId(records[0]?.id || "");
      activity(`${records.length} assets uploaded locally`, uploadClient);
      setPendingFiles([]);
      toast("Assets saved in this browser");
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    if (!selected) return;
    try {
      let url = selected.url;
      let temporary = false;
      if (selected.storagePath) {
        window.location.assign(selected.url + "&download=1");
        return;
      }
      if (selected.uploaded) {
        const blob = await loadFile(selected.id);
        if (!blob) throw new Error("This file is unavailable in this browser.");
        url = URL.createObjectURL(blob);
        temporary = true;
      }
      const link = document.createElement("a");
      link.href = url;
      link.download = selected.name;
      link.click();
      if (temporary) setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast((error as Error).message);
    }
  }
  return (
    <>
      <input
        id="asset-upload"
        type="file"
        className="visually-hidden"
        accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,application/pdf"
        multiple
        onChange={(e) => {
          if (e.target.files?.length) {
            setPendingFiles(Array.from(e.target.files));
            setUploadClient(clientId === "all" ? data.clients[0]?.id || "" : clientId);
          }
          e.target.value = "";
        }}
      />
      <div className="asset-layout">
        <aside className="panel asset-folders">
          {[
            "All assets",
            "Brand kits",
            "Campaigns",
            "Approved assets",
            "Archived",
          ].map((f) => (
            <button
              className={filter === f ? "selected" : ""}
              key={f}
              onClick={() => setFilter(f)}
            >
              <FolderOpen size={19} />
              {titleLabel(f)}
            </button>
          ))}
        </aside>
        <section className="panel asset-main">
          <div className="toolbar asset-toolbar">
            <label className="search-box">
              <Search size={18} />
              <input
                aria-label="Search Assets"
                placeholder="Search assets…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="Asset Client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="all">All Clients</option>
              {data.clients.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Asset Type"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="all">All Types</option>
              <option value="image/">Images</option>
              <option value="video/">Videos</option>
              <option value="application/pdf">PDFs</option>
            </select>
            <div className="segmented">
              <button
                className={view === "Grid" ? "selected" : ""}
                aria-pressed={view === "Grid"}
                onClick={() => setView("Grid")}
              >
                <Grid2X2 size={15} />
                Grid
              </button>
              <button
                className={view === "List" ? "selected" : ""}
                aria-pressed={view === "List"}
                onClick={() => setView("List")}
              >
                <List size={15} />
                List
              </button>
            </div>
          </div>
          <div
            className={"asset-grid " + (view === "List" ? "asset-list" : "")}
          >
            {assets.map((a) => (
              <button
                key={a.id}
                className={
                  "asset-card " + (selected?.id === a.id ? "selected" : "")
                }
                onClick={() => setSelectedId(a.id)}
              >
                <AssetPreview asset={a} />
                <div>
                  <strong>{a.name}</strong>
                  <small>
                    {data.clients.find((c) => c.id === a.clientId)?.name}
                  </small>
                  <span className="muted small-text">
                    {a.displayFormat || a.type.split("/")[1].toUpperCase()} ·{" "}
                    {a.size < 1024 * 1024
                      ? Math.round(a.size / 1024) + " KB"
                      : (a.size / 1024 / 1024).toFixed(1) + " MB"}
                  </span>
                  <Status value={a.status} />
                </div>
              </button>
            ))}
          </div>
          {!assets.length && (
            <Empty title="No Matching Assets">
              Upload a file or try a different filter.
            </Empty>
          )}
        </section>
        {selected && (
          <DetailsPanel title="Asset Details" className="asset-detail" onClose={() => setSelectedId("")}>
            <AssetPreview asset={selected} variant="detail" />
            <h2>{selected.name}</h2>
            <dl>
              <dt>Client</dt>
              <dd>
                {data.clients.find((c) => c.id === selected.clientId)?.name}
              </dd>
              <dt>Format</dt>
              <dd>
                {selected.displayFormat ||
                  selected.type.split("/")[1].toUpperCase()}
              </dd>
              {selected.dimensions && (
                <>
                  <dt>Dimensions</dt>
                  <dd>{selected.dimensions}</dd>
                </>
              )}
              <dt>Size</dt>
              <dd>{(selected.size / 1024 / 1024).toFixed(1)} MB</dd>
              <dt>Status</dt>
              <dd>
                <Status value={selected.status} />
              </dd>
              <dt>Storage</dt>
              <dd>
                {selected.storagePath ? "Private cloud storage" : selected.uploaded ? "This browser" : "Demo asset"}
              </dd>
            </dl>
            <div className="detail-section">
              <h3>Tags</h3>
              <div className="tags">
                {selected.tags.length ? (
                  selected.tags.map((t) => <span key={t}>{t}</span>)
                ) : (
                  <span>No tags yet</span>
                )}
              </div>
            </div>
            <div className="detail-section">
              <h3>Used In</h3>
              <div className="asset-used">
                <p>
                  Used in{" "}
                  {data.posts.filter((p) => p.assetId === selected.id).length}{" "}
                  posts
                </p>
              </div>
            </div>
            {selected.status === "Draft" &&
              session?.role !== "client_reviewer" && (
                <button
                  className="button full"
                  onClick={() => {
                    update((prev) => ({
                      ...prev,
                      assets: prev.assets.map((a) =>
                        a.id === selected.id ? { ...a, status: "Approved" } : a,
                      ),
                    }));
                    toast("Asset approved");
                  }}
                >
                  <Check size={16} />
                  Approve Asset
                </button>
              )}
            <button
              className="button primary full"
              disabled={session?.role === "client_reviewer"}
              onClick={() => {
                setSelectedId("");
                createFromAsset(selected);
              }}
            >
              <ImagePlus size={18} />
              Use in Content
            </button>
            <button className="button full" onClick={download}>
              <Download size={18} />
              Download
            </button>
          </DetailsPanel>
        )}
      </div>
      {pendingFiles.length > 0 && (
        <Modal
          title="Upload Assets"
          onClose={() => {
            if (!busy) setPendingFiles([]);
          }}
        >
          <p>
            {pendingFiles.length} file{pendingFiles.length > 1 ? "s" : ""}{" "}
            selected. Maximum 10 MB per file.
          </p>
          <Field label="Client">
            <select
              value={uploadClient}
              onChange={(e) => setUploadClient(e.target.value)}
            >
              {data.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <ul className="upload-files">
            {pendingFiles.map((f, i) => (
              <li key={i}>
                {f.name} <small>{(f.size / 1024).toFixed(0)} KB</small>
              </li>
            ))}
          </ul>
          <div className="modal-footer">
            <button
              className="button"
              disabled={busy}
              onClick={() => setPendingFiles([])}
            >
              Cancel
            </button>
            <button className="button primary" disabled={busy || !uploadClient} onClick={upload}>
              {busy ? "Saving…" : "Save Assets"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
