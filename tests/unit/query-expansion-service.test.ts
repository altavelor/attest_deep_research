import {
  parseQueryVariants,
  QueryExpansionService,
} from "../../src/retrieval/QueryExpansionService";
import { ChatModelProvider, ChatRequest, ChatResponseChunk } from "../../src/shared/types";

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

  it("rejects malformed model output", () => {
    expect(parseQueryVariants("not json", 8)).toEqual([]);
  });
});

class FakeChatModel implements ChatModelProvider {
  readonly requests: ChatRequest[] = [];

  constructor(private readonly chunks: ChatResponseChunk[]) {}

  async listModels(): Promise<string[]> {
    return ["granite"];
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    this.requests.push(request);

    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}
