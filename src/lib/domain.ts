import type { Post, PostStatus, Workspace } from "./types";
export function changePostStatus(
  post: Post,
  next: PostStatus,
  approvalRequired: boolean,
): Post {
  if (next === "Scheduled" && (!post.date || !post.time))
    throw new Error("Choose a publishing date and time before scheduling.");
  if (
    next === "Scheduled" &&
    approvalRequired &&
    post.status !== "Awaiting approval" &&
    post.status !== "Scheduled"
  )
    throw new Error("Submit this post for approval before scheduling.");
  if (post.status === "Published")
    throw new Error("Published posts cannot be changed in this workspace.");
  return { ...post, status: next };
}
export function monthCells(year: number, month: number): (string | null)[] {
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const count = Math.ceil((offset + days) / 7) * 7;
  return Array.from({ length: count }, (_, i) =>
    i < offset || i >= offset + days
      ? null
      : `${year}-${String(month + 1).padStart(2, "0")}-${String(i - offset + 1).padStart(2, "0")}`,
  );
}
export function clientMatch(clientId: string, selected: string) {
  return selected === "all" || clientId === selected;
}
export function formatDate(date: string) {
  return date
    ? new Date(date + "T12:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Unscheduled";
}
export function formatTime(time: string) {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
export function csv(rows: (string | number)[][]) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          let text = String(cell);
          if (/^[=+@-]/.test(text)) text = "'" + text;
          return '"' + text.replaceAll('"', '""') + '"';
        })
        .join(","),
    )
    .join("\r\n");
}
export function isWorkspace(value: unknown): value is Workspace {
  if (!value || typeof value !== "object") return false;
  const w = value as Partial<Workspace>;
  return (
    w.version === 1 &&
    Array.isArray(w.clients) &&
    Array.isArray(w.posts) &&
    Array.isArray(w.leads) &&
    Array.isArray(w.assets) &&
    Array.isArray(w.automations) &&
    Array.isArray(w.activities) &&
    !!w.preferences &&
    typeof w.preferences.name === "string"
  );
}
