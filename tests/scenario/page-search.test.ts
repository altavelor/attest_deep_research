import { InMemoryPageCacheStore } from "@adapters/research-tools/web/InMemoryPageCacheStore";
import { createResearchToolRegistry } from "@adapters/research-tools/createResearchToolRegistry";
import type { SearchProvider } from "@application/ports";
import { SubAgentRunner } from "@application/use-cases/research/sub-agent/SubAgentRunner";
import type { ModelRoundProvider, ModelRoundRequest, ModelRoundResult } from "@core/agent";
import { webSource } from "../support/factories";

const URL = "https://example.com/regulation";
const DEEP = "Open-source models are exempt from Article 53(2) documentation duties.";
const FILLER = "lorem ipsum dolor sit amet consectetur. ";
const BIG = `# Regulation\n${FILLER.repeat(9_000)}${DEEP} ${FILLER.repeat(1_000)}`;

const provider: SearchProvider = {
  search: async (query) => [{ source: webSource(URL), extractedText: "snippet", rank: 1, query }],
  fetchPage: async (url) => ({
    ok: true as const,
    url,
    finalUrl: url,
    content: BIG,
    contentType: "text/html",
    bytes: BIG.length,
    truncated: false,
    redirects: [url],
  }),
};

function call(id: string, name: string, args: Record<string, unknown>): ModelRoundResult {
  return {
    items: [{ type: "toolCall", call: { id, name, arguments: args } }],
    stopReason: "tool_calls",
  };
}

function lastToolMessage(request: ModelRoundRequest): string {
  return String(
    [...request.messages].reverse().find((message) => message.role === "tool")?.content,
  );
}

function scripted(
  steps: (request: ModelRoundRequest) => ModelRoundResult[],
): ModelRoundProvider & { requests: ModelRoundRequest[] } {
  const requests: ModelRoundRequest[] = [];
  return {
    requests,
    listModels: async () => ["m"],
    runRound: async (request) => {
      requests.push({ ...request, messages: [...request.messages] });
      return (
        steps(request)[requests.length - 1] ?? {
          items: [{ type: "text", text: "Done." }],
          stopReason: "complete",
        }
      );
    },
  };
}

function runner(modelRound: ModelRoundProvider, store: InMemoryPageCacheStore, sessionId: string) {
  return new SubAgentRunner({
    toolsetFactory: createResearchToolRegistry,
    searchProvider: provider,
    modelRound,
    model: "m",
  }).run({
    task: "What does Article 53(2) say?",
    toolContext: {
      availability: {
        searchMode: "webOnly",
        noteAccess: false,
        activeFileAccess: false,
        retrieverAvailable: false,
        webProviderAvailable: true,
        noteMutationAccess: false,
      },
      searchProvider: provider,
      pageCache: store.createChat().openSession(sessionId),
    },
  });
}

describe("page search in a sub-agent session", () => {
  it("lets the agent read a deep passage of a page larger than its whole tool output budget and keeps pages apart per session", async () => {
    const store = new InMemoryPageCacheStore();
    const first = scripted((request) => {
      const resultId = /"resultId":"([^"]+)"/u.exec(lastToolMessage(request))?.[1] ?? "";
      const offset = Number(/"offset":(\d+)/u.exec(lastToolMessage(request))?.[1] ?? 0);
      return [
        call("1", "search_web", { query: "eu", limit: 3 }),
        call("2", "fetch_web_page", { resultIds: [resultId] }),
        call("3", "find_in_pages", { query: "article 53(2) documentation" }),
        call("4", "read_page_range", { resultId, offset: Math.max(0, offset - 200) }),
      ];
    });

    const firstRun = await runner(first, store, "session-one");
    const handle = /"resultId":"([^"]+)"/u.exec(lastToolMessage(first.requests[3]!))?.[1] ?? "";

    const afterFetch = lastToolMessage(first.requests[2]!);
    const afterFind = lastToolMessage(first.requests[3]!);
    expect(afterFetch).toContain("find_in_pages");
    expect(afterFetch.length).toBeLessThan(6_000);
    expect(afterFind).toContain(DEEP);

    const afterRead = lastToolMessage(first.requests[4]!);
    expect(afterRead).toContain(DEEP);
    expect(firstRun.snapshot.evidence.some((chunk) => chunk.text.includes(DEEP))).toBe(true);

    const second = scripted(() => [
      call("1", "find_in_pages", { query: "article 53(2)" }),
      call("2", "read_page_range", { resultId: handle, offset: 0 }),
    ]);
    await runner(second, store, "session-two");

    expect(lastToolMessage(second.requests[1]!)).toContain("no-pages-fetched");
    expect(lastToolMessage(second.requests[2]!)).toContain("page-not-in-session");
  });
});
