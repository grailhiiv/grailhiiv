import { requestBody } from "@/lib/api";
import { n8nConfig, validCallbackToken, resultInput } from "@/lib/n8n";
import { automationService } from "@/lib/n8n-service";
import { z } from "zod";
export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    const runId = z
      .string()
      .uuid()
      .parse((await context.params).runId);
    const config = n8nConfig();
    const token =
      request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
    if (!config || !validCallbackToken(runId, token, config.callbackSecret))
      return Response.json(
        { error: "Invalid run credential." },
        { status: 401 },
      );
    const input = resultInput.parse(await requestBody(request));
    const { error } = await automationService().rpc("finish_automation", {
      run_id: runId,
      outcome: input.status,
      message: input.detail,
      execution: input.executionId,
    });
    if (error)
      return Response.json(
        { error: "Run cannot accept this result." },
        { status: 409 },
      );
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "Invalid automation result." },
      { status: 400 },
    );
  }
}
