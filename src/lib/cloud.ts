import type { Workspace } from "./types";
export type Role = "owner" | "team_member" | "client_reviewer";
export type CloudSession = {
  email: string;
  userId: string;
  workspaceId: string;
  role: Role;
};
export const recordKinds = [
  "clients",
  "posts",
  "leads",
  "automations",
  "assets",
] as const;
export type Change = {
  kind: (typeof recordKinds)[number];
  id: string;
  before: unknown;
  after: unknown;
};
export function emptyWorkspace(name = "GrailHiiv"): Workspace {
  return {
    version: 1,
    clients: [],
    posts: [],
    leads: [],
    automations: [],
    assets: [],
    activities: [],
    preferences: { name, notifications: true },
  };
}
export function diffWorkspace(before: Workspace, after: Workspace): Change[] {
  return recordKinds.flatMap((kind) => {
    const old = new Map<string, unknown>(before[kind].map((r) => [r.id, r]));
    const next = new Map<string, unknown>(after[kind].map((r) => [r.id, r]));
    return [...new Set([...old.keys(), ...next.keys()])].flatMap((id) => {
      const a = old.get(id) ?? null,
        b = next.get(id) ?? null;
      return JSON.stringify(a) === JSON.stringify(b)
        ? []
        : [{ kind, id, before: a, after: b }];
    });
  });
}
export async function cloudRequest<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "The request failed.");
  return data;
}
