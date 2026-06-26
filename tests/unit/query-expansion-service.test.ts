import {
  parseQueryVariants,
  QueryExpansionService,
} from "../../src/adapters/retrieval/QueryExpansionService";
import { FakeChatModel } from "../helpers/researchFakes";

describe("QueryExpansionService", () => {
  it("builds variants for languages present in the index but different from the query", async () => {
    const chatModel = new FakeChatModel([
      {
        content:
          '{"queries":[{"query":"sorting algorithms advantages disadvantages","language":"en","reason":"translated"}]}',
        isComplete: true,
      },
    ]);
    const service = new QueryExpansionService({
      chatModel,
      chatModelName: "granite",
    });

    await expect(
      service.buildVariants({
        query: "методы сортировки плюсы минусы",
        languageInventory: [
          { language: "ru", chunkCount: 2, sourceCount: 1 },
          { language: "en", chunkCount: 10, sourceCount: 3 },
          { language: "unknown", chunkCount: 1, sourceCount: 1 },
        ],
      }),
    ).resolves.toEqual([
      {
        query: "sorting algorithms advantages disadvantages",
        language: "en",
        reason: "translated",
      },
    ]);
    expect(chatModel.requests[0].messages[1].content).toContain("Target only these languages: en.");
    expect(chatModel.requests[0].messages[1].content).not.toContain("retrieved chunk");
  });

  it("skips expansion when no other known language exists", async () => {
    const chatModel = new FakeChatModel([
      {
        content:
          '{"queries":[{"query":"sorting algorithms advantages disadvantages","language":"en","reason":"translated"}]}',
        isComplete: true,
      },
    ]);
    const service = new QueryExpansionService({ chatModel, chatModelName: "granite" });

    await expect(
      service.buildVariants({
        query: "методы сортировки плюсы минусы",
        languageInventory: [{ language: "ru", chunkCount: 2, sourceCount: 1 }],
      }),
    ).resolves.toEqual([]);
    expect(chatModel.requests).toEqual([]);
  });

  it("reports diagnostics when model output cannot be parsed", async () => {
    const diagnostics: unknown[] = [];
    const chatModel = new FakeChatModel([{ content: "not json", isComplete: true }]);
    const service = new QueryExpansionService({
      chatModel,
      chatModelName: "granite",
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    await expect(
      service.buildVariants({
        query: "методы сортировки плюсы минусы",
        languageInventory: [
          { language: "ru", chunkCount: 2, sourceCount: 1 },
          { language: "en", chunkCount: 10, sourceCount: 3 },
        ],
      }),
    ).resolves.toEqual([]);
    expect(diagnostics).toEqual([
      { source: "query-expansion", ok: false, reason: "json-not-found", inputLength: 8 },
    ]);
  });

  it("rejects malformed model output", () => {
    expect(parseQueryVariants("not json", 8)).toEqual([]);
  });

  it("parses variants from JSON wrapped in markdown", () => {
    expect(
      parseQueryVariants(
        'Here is the plan:\n```json\n{"queries":[{"query":" sorting   algorithms ","language":" EN ","reason":"translated"}]}\n```',
        8,
      ),
    ).toEqual([
      {
        query: "sorting algorithms",
        language: "en",
        reason: "translated",
      },
    ]);
  });

  it("bounds parsed variants by max count and query length", () => {
    expect(
      parseQueryVariants(
        JSON.stringify({
          queries: [{ query: "alpha" }, { query: "x".repeat(241) }, { query: "beta" }],
        }),
        1,
      ),
    ).toEqual([{ query: "alpha" }]);
  });
});
