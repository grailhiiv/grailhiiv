import { z } from "zod";
const text = z.string().max(20000);
const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const notes = z.array(z.object({ text, date: text })).max(500);
export const schemas = {
  clients: z
    .object({
      id,
      name: text,
      initials: text,
      color: text,
      website: text,
      contact: text,
      email: text,
      timezone: text,
      voice: text,
      audience: text,
      approvalRequired: z.boolean(),
      logo: text.optional(),
      description: text.optional(),
    })
    .strict(),
  posts: z
    .object({
      id,
      clientId: id,
      title: text,
      caption: text,
      platform: text,
      date: text,
      time: text,
      status: z.enum([
        "Draft",
        "Awaiting approval",
        "Changes requested",
        "Scheduled",
        "Published",
      ]),
      assetId: text,
      notes,
      metrics: z
        .object({
          reach: z.number(),
          engagements: z.number(),
          leads: z.number(),
        })
        .optional(),
    })
    .strict(),
  leads: z
    .object({
      id,
      clientId: id,
      name: text,
      email: text,
      source: text,
      stage: z.enum(["New", "Qualified", "Contacted", "Won"]),
      interest: text,
      task: text,
      due: text,
      notes,
    })
    .strict(),
  automations: z
    .object({
      id,
      name: text,
      clientId: id,
      trigger: text,
      enabled: z.boolean(),
      runs: z
        .array(
          z.object({
            id,
            date: text,
            status: z.enum(["Success", "Failed"]),
            detail: text,
          }),
        )
        .max(500),
    })
    .strict(),
  assets: z
    .object({
      id,
      clientId: id,
      name: text,
      type: text,
      size: z.number().nonnegative(),
      url: text,
      status: z.enum(["Approved", "Draft"]),
      tags: z.array(text).max(100),
      uploaded: z.boolean(),
      storagePath: text.optional(),
      thumbnailPath: text.optional(),
      thumbnailSize: z.number().int().min(1).max(131072).optional(),
      variants: z
        .object({
          overview: text.optional(),
          calendar: text.optional(),
          approval: text.optional(),
          detail: text.optional(),
        })
        .optional(),
      dimensions: text.optional(),
      displayFormat: text.optional(),
    })
    .strict()
    .superRefine((asset, ctx) => {
      if (Boolean(asset.thumbnailPath) !== Boolean(asset.thumbnailSize) || (!asset.uploaded && asset.thumbnailPath)) ctx.addIssue({ code: "custom", message: "Thumbnail metadata requires an uploaded asset and a size." });
      if (!asset.uploaded && asset.storagePath !== undefined)
        ctx.addIssue({
          code: "custom",
          path: ["storagePath"],
          message: "Demo assets cannot reference private storage.",
        });
      if (asset.uploaded && !asset.storagePath)
        ctx.addIssue({
          code: "custom",
          path: ["storagePath"],
          message: "Uploaded assets require a storage path.",
        });
    }),
};
export const commitSchema = z
  .object({
    workspaceId: z.string().uuid(),
    changes: z
      .array(
        z
          .object({
            kind: z.enum([
              "clients",
              "posts",
              "leads",
              "assets",
              "automations",
            ]),
            id,
            before: z.unknown(),
            after: z.unknown(),
          })
          .strict(),
      )
      .max(500),
    preferences: z
      .object({ name: text, notifications: z.boolean() })
      .optional(),
  })
  .strict();
export function validateChanges(
  changes: z.infer<typeof commitSchema>["changes"],
  workspaceId?: string,
) {
  for (const change of changes)
    for (const record of [change.before, change.after]) {
      if (record !== null) {
        const parsed = schemas[change.kind].parse(record);
        if (parsed.id !== change.id)
          throw new Error("Record ID does not match.");
        if (change.kind === "assets" && workspaceId)
          validateAssetStorage(workspaceId, schemas.assets.parse(record));
      }
    }
}

export function validateAssetStorage(
  workspaceId: string,
  asset: z.infer<typeof schemas.assets>,
) {
  if (!asset.uploaded) return;
  const parts = asset.storagePath?.split("/");
  if (
    !parts ||
    parts.length !== 3 ||
    parts[0] !== workspaceId ||
    parts[1] !== asset.clientId ||
    !parts[2] ||
    [".", ".."].includes(parts[2])
  )
    throw new Error("Asset storage path does not belong to this client.");
  if (asset.thumbnailPath) {
    const thumbnail = asset.thumbnailPath.split("/");
    if (thumbnail.length !== 3 || thumbnail[0] !== workspaceId || thumbnail[1] !== asset.clientId || !/^[a-zA-Z0-9_-]+-thumb\.webp$/.test(thumbnail[2])) throw new Error("Thumbnail does not belong to this client.");
  }
}
