import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { Command } from "@langchain/langgraph";
import {
  agentModels,
  planSchema,
  type AgentModel,
  type ContentPlan,
  modelSchema,
} from "../src/lib/agent-config";
import { contentGraph } from "../src/lib/agent-graph";
import { contentModel } from "../src/lib/agent-model";
import { agentCheckpoints } from "../src/lib/agent-checkpoints";
import { heartbeat } from "../src/lib/worker-monitor";

type Job = {
  id: string;
  workspace_id: string;
  client_id: string;
  lease: string;
  brief: string;
  model_config: AgentModel;
  decision: boolean | null;
  generation_seq: number;
  regenerate_index: number | null;
  proposal: ContentPlan | null;
};
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret || !agentModels().length)
    throw new Error("Configure AI providers and Supabase.");
  const db = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const checkpoints = agentCheckpoints();
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });
  console.log("GrailHiiv AI worker started.");
  const pulse = setInterval(() => void heartbeat(db, "ai"), 30_000);
  let lastPrune = 0;
  try {
    while (!stopping) {
      let job: Job | undefined;
      try {
        await heartbeat(db, "ai");
        if (Date.now() - lastPrune > 3600000) {
          const cleanup = await db.rpc("checkpoint_cleanup_candidates");
          if (cleanup.error) throw cleanup.error;
          for (const row of cleanup.data || []) {
            for (let seq = 0; seq <= row.generation_seq; seq++)
              await checkpoints.deleteThread(
                `${row.workspace_id}:${row.id}${seq ? `:${seq}` : ""}`,
              );
            await db
              .from("agent_runs")
              .update({ checkpoint_pruned_at: new Date().toISOString() })
              .eq("id", row.id);
          }
          lastPrune = Date.now();
        }
        const { data, error } = await db.rpc("claim_agent");
        if (error) throw error;
        job = data?.[0];
        if (!job) {
          await delay(3000);
          continue;
        }
        const claimed = job;
        // Require the administrator's current catalog to match the queued snapshot.
        const selected = agentModels().find(
          (m) =>
            m.key === claimed.model_config.key &&
            m.provider === claimed.model_config.provider &&
            m.model === claimed.model_config.model &&
            m.maxTokens === claimed.model_config.maxTokens,
        );
        async function finish(outcome: string, plan: unknown = null) {
          const { error } = await db.rpc("finish_agent", {
            run_id: claimed.id,
            token: claimed.lease,
            outcome,
            plan,
          });
          if (error) throw error;
        }
        const graph = contentGraph(checkpoints, {
          context: async () => {
            const { data, error } = await db.rpc("agent_context", {
              run_id: claimed.id,
              token: claimed.lease,
            });
            if (error) throw error;
            return data;
          },
          generate: async (brief, brand) => {
            if (claimed.decision !== null && claimed.proposal)
              return claimed.proposal;
            if (!selected) throw new Error("Model configuration changed.");
            // Prices and reasoning settings come from the administrator's catalog,
            // never from an authenticated caller's stored job JSON.
            const prepared = await db.rpc("prepare_agent_config", {
              rid: claimed.id,
              lease_token: claimed.lease,
              config: selected,
            });
            if (prepared.error) throw prepared.error;
            const reserved = await db.rpc("reserve_agent_call", {
              rid: claimed.id,
              lease_token: claimed.lease,
            });
            if (reserved.error) throw reserved.error;
            return contentModel(
              modelSchema.parse(prepared.data),
              async (usage) => {
                const report = await db.rpc("report_agent_usage", {
                  rid: claimed.id,
                  lease_token: claimed.lease,
                  input_count: usage.input,
                  output_count: usage.output,
                });
                if (report.error) throw report.error;
              },
              claimed.proposal || undefined,
              claimed.regenerate_index,
            )(brief, brand);
          },
          save: () => finish("Completed"),
        });
        const config = {
          configurable: {
            thread_id: `${claimed.workspace_id}:${claimed.id}${claimed.generation_seq ? `:${claimed.generation_seq}` : ""}`,
          },
          recursionLimit: 10,
          signal: AbortSignal.timeout(180_000),
        };
        const state = await graph.getState(config);
        if (claimed.decision !== null && !state.createdAt && claimed.proposal) {
          await graph.invoke({ brief: claimed.brief }, config);
        }
        // A restarted worker continues saved nodes. Human decisions are supplied
        // only from the authenticated database RPC, never from model output.
        const result =
          claimed.decision !== null &&
          (state.tasks.some((t) => t.interrupts?.length) ||
            (!state.createdAt && Boolean(claimed.proposal)))
            ? await graph.invoke(
                new Command({ resume: { approved: claimed.decision } }),
                config,
              )
            : await graph.invoke(
                state.createdAt ? null : { brief: claimed.brief },
                config,
              );
        const next = await graph.getState(config);
        if (next.tasks.some((t) => t.interrupts?.length)) {
          await finish("Awaiting approval", planSchema.parse(result.plan));
        } else if (claimed.decision === false) {
          await finish("Rejected");
        }
      } catch (failure) {
        await heartbeat(db, "ai", false, "provider_or_job_failed");
        console.error(
          "AI run unavailable. Check provider configuration, checkpoint storage and migrations.",
        );
        if (job) {
          const message =
            typeof failure === "object" && failure && "message" in failure
              ? String(failure.message)
              : "";
          const code = message.includes("Hourly AI call limit")
            ? "hourly_limit"
            : message.includes("Daily AI token limit")
              ? "daily_tokens"
              : message.includes("AI budget")
                ? "daily_budget"
                : "generation_failed";
          await db.rpc("fail_agent", {
            rid: job.id,
            lease_token: job.lease,
            code,
          });
        }
        await delay(3000);
      }
    }
  } finally {
    clearInterval(pulse);
    await checkpoints.end();
  }
}
main().catch(() => {
  console.error("AI worker configuration is invalid.");
  process.exitCode = 1;
});
