import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
export function agentCheckpoints() {
  const url = process.env.GRAILHIIV_AI_DATABASE_URL;
  if (!url) throw new Error("Configure the private AI checkpoint database.");
  return PostgresSaver.fromConnString(url, { schema: "grailhiiv_agent" });
}
