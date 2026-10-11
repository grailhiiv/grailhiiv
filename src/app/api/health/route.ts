import { hasSupabase } from "@/lib/supabase/config";
import { automationService } from "@/lib/n8n-service";
import { agentModels } from "@/lib/agent-config";
import { workerIsHealthy } from "@/lib/worker-monitor";
import { metaConfig } from "@/lib/social-meta";
export async function GET() {
  let aiConnected = false,
    internalConnected = false,
    automationConnected = false,
    publishingConnected = false;
  if (hasSupabase() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { data } = await automationService()
        .from("worker_status")
        .select("name,last_seen,healthy")
        .abortSignal(AbortSignal.timeout(2000));
      aiConnected = Boolean(
        process.env.GRAILHIIV_AI_DATABASE_URL &&
        agentModels().length &&
        workerIsHealthy(data?.find((r) => r.name === "ai")),
      );
      internalConnected = workerIsHealthy(
        data?.find((r) => r.name === "internal"),
      );
      automationConnected = workerIsHealthy(
        data?.find((r) => r.name === "n8n"),
      );
      publishingConnected = metaConfig().configured && workerIsHealthy(data?.find(r => r.name === "social"));
    } catch {}
  }
  return Response.json({
    status: "ok",
    mode: hasSupabase() ? "supabase" : "local-demo",
    integrationsConnected: hasSupabase(),
    aiConnected,
    internalConnected,
    automationConnected,
    publishingConnected,
  });
}
