import { ResearchService } from "@application/use-cases/research";
import { ThinkingResearchRunner } from "@application/use-cases/research/ThinkingResearchRunner";
import { ToolManager } from "@application/tools/ToolManager";
import { createResearchToolRegistry, runToolLoop } from "@adapters/research-tools";
import { ChatCompletionsRoundAdapter } from "@adapters/model-provider";
import { createTranslator, type MessageKey } from "@adapters/i18n";
import { describeToolCall } from "@apps/obsidian/ui/chat/toolCallView";
import type { ModelRoundRequest, Tool } from "@core/agent";
import { emptyRetrieval, fixedNow } from "../support/factories";
import { collectAsync } from "../support/async";
import { FakeChatModel, FakeRetriever, scriptedModelRounds } from "../support/researchFakes";

const REPORTED_ANSWER = [
  "Запускаю агента для поиска погоды в Канзасе.",
  "<tool_run_subagent>",
  "Find the current weather in Kansas",
  "[]",
  "6",
  "</tool_run_subagent>",
  "<tool_wait_subagents>",
  "30000",
  "</tool_wait_subagents>",
].join("\n");

function instantService(chunks: string[], locale: "ru" | "en") {
  const { t } = createTranslator(locale);
  return new ResearchService({
    toolsetFactory: createResearchToolRegistry,
    runToolLoop,
    modelRoundFactory: (model) => new ChatCompletionsRoundAdapter(model),
    retriever: new FakeRetriever(emptyRetrieval()),
    chatModel: new FakeChatModel([
      ...chunks.map((content) => ({ content, isComplete: false })),
      { content: "", isComplete: true },
    ]),
    chatModelName: "deepseek",
    now: fixedNow,
    translate: (key, params) => t(key as MessageKey, params),
  });
}

function searchTool(): Tool<Record<string, unknown>, unknown> {
  return {
    definition: {
      type: "function",
      function: {
        name: "search_index",
        description: "search",
        parameters: { type: "object", properties: {} },
      },
    },
    parseInput: (value) => ({ ok: true, value }),
    execute: async () => ({ ok: true, value: { results: [] } }),
  };
}

describe("calls to tools the run does not offer", () => {
  it("replaces streamed Instant markup with the localized sub-agent notice in the saved answer", async () => {
    const events = await collectAsync(
      instantService([REPORTED_ANSWER.slice(0, 60), REPORTED_ANSWER.slice(60)], "ru").answer({
        question: "Запусти агента для поиска погоды в Канзасе",
        mode: "instant",
        searchMode: "indexOnly",
      }),
    );
    const complete = events.find((event) => event.type === "complete");

    expect(complete?.type === "complete" && complete.answer.answer).toBe(
      "Запускаю агента для поиска погоды в Канзасе.\n\n" +
        "Модель попыталась запустить субагента («run_subagent»). " +
        "Субагенты доступны только в режиме «Размышление».",
    );
  });

  it("names a non-delegation tool and the Instant mode in the notice", async () => {
    const events = await collectAsync(
      instantService(['<tool_call>{"name": "search_web"}</tool_call>'], "en").answer({
        question: "Weather in Kansas?",
        mode: "instant",
        searchMode: "indexOnly",
      }),
    );
    const complete = events.find((event) => event.type === "complete");

    expect(complete?.type === "complete" && complete.answer.answer).toBe(
      'The model tried to call "search_web", which is not available in Instant mode. ' +
        "Switch to Thinking and ask again.",
    );
  });

  it("fails a Thinking call to an unoffered tool, lists the offered ones and shows a localized row", async () => {
    const results: { ok: boolean; json?: string }[] = [];
    const modelRound = scriptedModelRounds((_request: ModelRoundRequest, index) =>
      index === 1
        ? {
            items: [
              {
                type: "toolCall" as const,
                call: { id: "c1", name: "run_subagent", arguments: { task: "weather" } },
              },
            ],
            stopReason: "tool_calls" as const,
          }
        : { items: [{ type: "text" as const, text: "done" }], stopReason: "complete" as const },
    );
    await new ThinkingResearchRunner({
      modelRound,
      model: "m",
      messages: [{ role: "user", content: "q" }],
      tools: new ToolManager([searchTool()]),
      policy: {
        strategy: "thinking",
        reason: "thinking-eligible",
        requiredTools: [],
        bootstrapChoice: { type: "auto" },
        parallelToolCalls: false,
        supportsSpecificChoice: true,
      },
      onToolResult: (_id, ok, _label, _summary, json) => results.push({ ok, json }),
    }).run();

    const toolMessage = modelRound.requests[1].messages.find((message) => message.role === "tool");
    expect(JSON.parse(toolMessage?.content ?? "{}")).toMatchObject({
      ok: false,
      error: {
        code: "tool-unavailable",
        message:
          'Tool "run_subagent" is not available: it is not offered in this run. ' +
          "Available tools: search_index.",
      },
    });
    expect(results).toEqual([{ ok: false, json: toolMessage?.content }]);
    const row = describeToolCall({
      t: createTranslator("en").t,
      name: "run_subagent",
      label: "run_subagent",
      status: "failed",
      resultJson: results[0].json,
    });
    expect(row.badge).toEqual({ text: '"run_subagent" is not available in this run.' });
  });
});
