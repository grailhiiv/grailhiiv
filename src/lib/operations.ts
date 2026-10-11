import { z } from "zod";
export const limitsSchema = z
  .object({
    hourly_ai_calls: z.number().int().min(1).max(200),
    daily_ai_tokens: z.number().int().min(1000).max(10000000),
    daily_ai_budget: z.number().min(0).max(10000),
    asset_quota_bytes: z.number().int().min(10485760).max(107374182400),
    checkpoint_days: z.number().int().min(1).max(365),
    reasoning_effort: z
      .enum(["default", "none", "low", "medium", "high", "xhigh", "max"])
      .default("default"),
  })
  .strict();
export const defaultLimits: z.infer<typeof limitsSchema> = {
  hourly_ai_calls: 30,
  daily_ai_tokens: 100000,
  daily_ai_budget: 0,
  asset_quota_bytes: 1073741824,
  checkpoint_days: 30,
  reasoning_effort: "default",
};
export const ruleSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    client_id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    event: z.enum(["lead_created", "post_approved", "schedule"]),
    action: z.enum(["activity", "followup"]),
    message: z.string().trim().min(1).max(500),
    interval_minutes: z.number().int().min(5).max(10080),
    due_days: z.number().int().min(0).max(90),
    enabled: z.boolean(),
  })
  .strict()
  .refine(
    (r) => r.action !== "followup" || r.event === "lead_created",
    "Follow-ups require the lead-created event.",
  );
export type Limits = z.infer<typeof limitsSchema>;
export type InternalRule = z.infer<typeof ruleSchema> & { id: string };
export type OperationsData = {
  totals?: {
    tokens: number;
    reserved: number;
    cost: number;
    unpriced: number;
    asset_bytes: number;
  };
  settings: Limits;
  workers: {
    name: string;
    healthy: boolean;
    last_seen: string;
    error_code: string;
    available: boolean;
  }[];
  usage: {
    input_tokens: number | null;
    output_tokens: number | null;
    reserved_tokens: number;
    estimated_cost: number | null;
    reserved_cost: number;
    created_at: string;
  }[];
  rules: InternalRule[];
  runs: {
    id: string;
    status: string;
    detail: string;
    attempts: number;
    created_at: string;
  }[];
  backups: { id: string; status: string; detail: string; created_at: string }[];
  assetsBytes: number;
};
