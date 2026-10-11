import {
  Annotation,
  StateGraph,
  START,
  END,
  interrupt,
} from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { planSchema, type ContentPlan } from "./agent-config";

const State = Annotation.Root({
  brief: Annotation<string>(),
  brand: Annotation<Record<string, unknown>>(),
  plan: Annotation<ContentPlan>(),
  approved: Annotation<boolean>(),
});
export type AgentTools = {
  context: () => Promise<Record<string, unknown>>;
  generate: (
    brief: string,
    brand: Record<string, unknown>,
  ) => Promise<ContentPlan>;
  save: () => Promise<void>;
};
// Tools close over the claimed run's identity and lease. Model output cannot choose
// a workspace, client, post status, or external endpoint.
export function contentGraph(
  checkpointer: BaseCheckpointSaver,
  capabilities: AgentTools,
) {
  const readBrand = tool(capabilities.context, {
    name: "read_client_brand",
    description: "Read the authorized client's brand voice and audience.",
    schema: z.object({}).strict(),
  });
  const saveDrafts = tool(
    async () => {
      await capabilities.save();
      return "Drafts saved";
    },
    {
      name: "create_content_drafts",
      description:
        "Create the exact human-accepted proposal as unscheduled drafts.",
      schema: z.object({}).strict(),
    },
  );
  return new StateGraph(State)
    .addNode("load_brand", async () => ({ brand: await readBrand.invoke({}) }))
    .addNode("generate", async (state) => ({
      plan: planSchema.parse(
        await capabilities.generate(state.brief, state.brand),
      ),
    }))
    .addNode("review", (state) =>
      z
        .object({ approved: z.boolean() })
        .strict()
        .parse(interrupt({ tool: "create_content_drafts", plan: state.plan })),
    )
    .addNode("save", async () => {
      await saveDrafts.invoke({});
      return {};
    })
    .addEdge(START, "load_brand")
    .addEdge("load_brand", "generate")
    .addEdge("generate", "review")
    .addConditionalEdges("review", (state) => (state.approved ? "save" : END))
    .addEdge("save", END)
    .compile({ checkpointer });
}
