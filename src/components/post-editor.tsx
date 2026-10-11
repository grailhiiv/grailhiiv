"use client";
import { useState } from "react";
import { useWorkspace } from "./workspace-provider";
import { Modal, Field } from "./ui";
import type { Post } from "@/lib/types";
export function PostEditor({
  post,
  onClose,
  defaultDate = "",
  initialAsset,
  initialClient,
}: {
  post?: Post;
  onClose: () => void;
  defaultDate?: string;
  initialAsset?: string;
  initialClient?: string;
}) {
  const { data, clientId, update, toast, activity } = useWorkspace();
  const [form, setForm] = useState({
    clientId:
      post?.clientId ||
      initialClient ||
      (clientId === "all" ? data.clients[0].id : clientId),
    title: post?.title || "",
    caption: post?.caption || "",
    platform: post?.platform || "Instagram",
    date: post?.date || defaultDate,
    time: post?.time || "09:00",
    assetId: post?.assetId || initialAsset || "",
  });
  const [error, setError] = useState("");
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim()) {
      setError("Add a title for this post.");
      return;
    }
    if (form.date && !form.time) {
      setError("Choose a publishing time.");
      return;
    }
    const asset = data.assets.find((a) => a.id === form.assetId);
    if (asset && asset.clientId !== form.clientId) {
      setError("Choose an asset belonging to this client.");
      return;
    }
    const record: Post = {
      ...form,
      title: form.title.trim(),
      id: post?.id || crypto.randomUUID(),
      status: "Draft",
      notes: post?.notes || [],
    };
    update((prev) => ({
      ...prev,
      posts: post
        ? prev.posts.map((p) => (p.id === post.id ? record : p))
        : [record, ...prev.posts],
    }));
    activity(
      post ? "Content updated as a draft" : "New content draft created",
      form.clientId,
    );
    toast("Draft saved");
    onClose();
  }
  return (
    <Modal
      title={post ? "Edit Content" : "Create Content"}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Client">
            <select
              value={form.clientId}
              onChange={(e) =>
                setForm({ ...form, clientId: e.target.value, assetId: "" })
              }
            >
              {data.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Platform">
            <select
              value={form.platform}
              onChange={(e) => setForm({ ...form, platform: e.target.value })}
            >
              {["Instagram", "Facebook", "LinkedIn", "TikTok", "X"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Post Title">
          <input
            autoComplete="off"
            maxLength={120}
            required
            value={form.title}
            placeholder="What are we sharing?"
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label="Caption">
          <textarea
            rows={5}
            maxLength={2200}
            value={form.caption}
            placeholder="Write your caption…"
            onChange={(e) => setForm({ ...form, caption: e.target.value })}
          />
        </Field>
        <div className="form-grid">
          <Field label="Publishing Date (Optional)">
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </Field>
          <Field label="Time">
            <input
              type="time"
              value={form.time}
              onChange={(e) => setForm({ ...form, time: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Asset">
          <select
            value={form.assetId}
            onChange={(e) => setForm({ ...form, assetId: e.target.value })}
          >
            <option value="">No Asset</option>
            {data.assets
              .filter((a) => a.clientId === form.clientId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </Field>
        <p className="muted small-text">
          Saved as a draft. Submit it for approval from the calendar when it is
          ready. Timezone:{" "}
          {data.clients.find((c) => c.id === form.clientId)?.timezone}.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit">
            Save Draft
          </button>
        </div>
      </form>
    </Modal>
  );
}
