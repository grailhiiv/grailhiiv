import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { n8nConfig, dispatchRun, type DispatchRun } from "../src/lib/n8n";
import { heartbeat } from "../src/lib/worker-monitor";

async function main() {
  const config = n8nConfig();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const callbackBase =
    process.env.GRAILHIIV_N8N_CALLBACK_URL || process.env.GRAILHIIV_SITE_URL;
  if (!config || !url || !secret || !callbackBase)
    throw new Error(
      "Configure n8n, Supabase and the callback origin before starting the worker.",
    );
  const db = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let stopping = false;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });
  console.log("GrailHiiv automation worker started.");
  while (!stopping) {
    try {
      await heartbeat(db, "n8n");
      const { data, error } = await db.rpc("claim_automation");
      if (error)
        throw new Error(
          "Cannot claim automation jobs. Check credentials and migrations.",
        );
      const run = data?.[0] as DispatchRun | undefined;
      if (run) {
        let outcome: "Failed" | "Unknown" | undefined;
        let message = "";
        if (!config.workflows.some((w) => w.key === run.workflow_key)) {
          outcome = "Failed";
          message =
            "Workflow is no longer configured. Ask the owner to reconnect it.";
        } else {
          try {
            const response = await dispatchRun(run, config, callbackBase);
            // Accepted is not completed. Only the authenticated callback reports success.
            if (!response.ok) {
              outcome = [401, 403, 404].includes(response.status)
                ? "Failed"
                : "Unknown";
              message =
                outcome === "Failed"
                  ? "n8n rejected the workflow. Check its published webhook and credential."
                  : "n8n returned an error. Check its execution before running again.";
            }
            await response.body?.cancel();
          } catch {
            outcome = "Unknown";
            message =
              "Delivery could not be confirmed. Check n8n executions before running again.";
          }
        }
        if (outcome) {
          const result = await db.rpc("finish_automation", {
            run_id: run.id,
            outcome,
            message,
            execution: null,
          });
          if (result.error)
            console.error(
              "Could not record dispatch outcome; the job will expire safely.",
            );
        }
        continue;
      }
    } catch {
      await heartbeat(db, "n8n", false, "database_unavailable");
      // Never log request bodies, tokens, connection strings or upstream error text.
      console.error(
        "Automation worker unavailable. Check database access and migrations.",
      );
    }
    await delay(3000);
  }
}
main().catch(() => {
  console.error("Automation worker configuration is invalid.");
  process.exitCode = 1;
});
