import { z } from "zod";

export const modelSchema = z
  .object({
    key: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    label: z.string().min(1).max(100),
    provider: z.enum(["openai", "anthropic"]),
    model: z.string().min(1).max(200),
    maxTokens: z.number().int().min(256).max(8192).default(4096),
    reasoningEffort: z
      .enum(["none", "low", "medium", "high", "xhigh", "max"])
      .optional(),
    inputPricePerMillion: z.number().nonnegative().max(1000).optional(),
    outputPricePerMillion: z.number().nonnegative().max(1000).optional(),
  })
  .strict();
export type AgentModel = z.infer<typeof modelSchema>;
export function agentModels(
  env: Record<string, string | undefined> = process.env,
): AgentModel[] {
  const models = z
    .array(modelSchema)
    .max(20)
    .parse(JSON.parse(env.GRAILHIIV_AI_MODELS || "[]"));
  if (new Set(models.map((m) => m.key)).size !== models.length)
    throw new Error("Duplicate AI model keys.");
  return models.filter((m) =>
    Boolean(
      env[m.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"],
    ),
  );
}
export const generatedPlanSchema = z
  .object({
    posts: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(200),
            caption: z.string().trim().min(1).max(5000),
            platform: z.enum([
              "Instagram",
              "Facebook",
              "LinkedIn",
              "TikTok",
              "X",
            ]),
          })
          .strict(),
      )
      .length(5),
  })
  .strict();
export const postSchema = generatedPlanSchema.shape.posts.element.extend({
  date: z
    .string()
    .regex(/^$|^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  assetId: z.string().max(100).optional(),
});
export const planSchema = z
  .object({ posts: z.array(postSchema).length(5) })
  .strict();
export type ContentPlan = z.infer<typeof planSchema>;
export type AgentRun = {
  id: string;
  client_id: string;
  model_key: string;
  brief: string;
  status:
    | "Queued"
    | "Running"
    | "Awaiting approval"
    | "Completed"
    | "Rejected"
    | "Failed";
  detail: string;
  proposal: ContentPlan | null;
  created_at: string;
  finished_at?: string | null;
};
export const agentInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("generate"),
      workspaceId: z.string().uuid(),
      clientId: z.string().min(1).max(100),
      requestId: z.string().uuid(),
      modelKey: modelSchema.shape.key,
      brief: z.string().trim().min(1).max(4000),
    })
    .strict(),
  z
    .object({
      action: z.literal("decide"),
      workspaceId: z.string().uuid(),
      runId: z.string().uuid(),
      approved: z.boolean(),
      expectedProposal: planSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("edit"),
      workspaceId: z.string().uuid(),
      runId: z.string().uuid(),
      expectedProposal: planSchema,
      proposal: planSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("regenerate"),
      workspaceId: z.string().uuid(),
      runId: z.string().uuid(),
      index: z.number().int().min(0).max(4),
      requestId: z.string().uuid(),
      expectedProposal: planSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("retry"),
      workspaceId: z.string().uuid(),
      runId: z.string().uuid(),
    })
    .strict(),
]);
