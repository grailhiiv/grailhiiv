import { test } from "node:test";
import assert from "node:assert/strict";
import { contentModel } from "../src/lib/agent-model";
import { planSchema } from "../src/lib/agent-config";
test("model adapter passes reasoning effort, records provider usage, and replaces only one caption", async (t) => {
  const oldFetch = globalThis.fetch,
    oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "mock-key";
  t.after(() => {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  });
  const original = planSchema.parse({
    posts: Array.from({ length: 5 }, (_, i) => ({
      title: `Title ${i}`,
      caption: `Caption ${i}`,
      platform: "Instagram",
      date: "2026-10-20",
      time: "09:00",
    })),
  });
  let single = false;
  const requests: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const parsed = single
      ? {
          title: "Replacement",
          caption: "Only this caption changes",
          platform: "LinkedIn",
        }
      : {
          posts: original.posts.map(({ title, caption, platform }) => ({
            title,
            caption,
            platform,
          })),
        };
    const response = String(_url).includes("/responses")
      ? {
          id: "resp_mock",
          object: "response",
          created_at: 1,
          status: "completed",
          model: "gpt-5.6-luna",
          output: [
            {
              id: "msg_mock",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(parsed),
                  annotations: [],
                },
              ],
            },
          ],
          usage: {
            input_tokens: 25,
            output_tokens: 35,
            total_tokens: 60,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        }
      : {
          id: "chatcmpl-mock",
          object: "chat.completion",
          created: 1,
          model: "gpt-5.6-luna",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_mock",
                    type: "function",
                    function: {
                      name: "content_plan",
                      arguments: JSON.stringify(parsed),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 25, completion_tokens: 35, total_tokens: 60 },
        };
    return new Response(JSON.stringify(response), {
      headers: { "content-type": "application/json" },
    });
  };
  const usage: { input: number; output: number }[] = [];
  const config = {
    key: "test",
    label: "Test",
    provider: "openai" as const,
    model: "gpt-5.6-luna",
    maxTokens: 4096,
    reasoningEffort: "low" as const,
  };
  const generate = contentModel(config, async (u) => {
    usage.push(u);
  });
  assert.equal(
    (await generate("Write captions", { name: "Test" })).posts.length,
    5,
  );
  assert.deepEqual(usage[0], { input: 25, output: 35 });
  assert.equal(
    (requests[0].reasoning as { effort: string } | undefined)?.effort ||
      requests[0].reasoning_effort,
    "low",
  );
  single = true;
  const regenerate = contentModel(
    config,
    async (u) => {
      usage.push(u);
    },
    original,
    2,
  );
  const result = await regenerate("Write captions", { name: "Test" });
  assert.deepEqual(result.posts[0], original.posts[0]);
  assert.equal(result.posts[2].caption, "Only this caption changes");
  assert.equal(result.posts[2].date, "2026-10-20");
});
