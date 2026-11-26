import type { ChatModelProvider, ChatRequest } from "@core/agent";
import type { ResearchChatHistoryMessage } from "@core/research";
import {
  NO_CLARIFICATION_ASSUMPTION,
  clarificationPrompt,
  parseClarification,
  type ClarificationOutcome,
} from "@core/research/deepResearch";

export interface ResearchClarificationOptions {
  chatModel: ChatModelProvider;
  model: string;
  chatOptions: Pick<ChatRequest, "temperature" | "maxTokens">;
  chatHistory?: readonly ResearchChatHistoryMessage[];
  signal?: AbortSignal;
}

/**
 * Decides with one structured model call whether a research question needs clarification before
 * planning. A failed call or malformed reply never retries: it yields `ready` with the explicit
 * no-clarification assumption and is marked failed so planning can count it; an abort rethrows.
 */
export class ResearchClarificationService {
  constructor(private readonly options: ResearchClarificationOptions) {}

  async decide(question: string): Promise<ClarificationOutcome> {
    const { options } = this;
    let reply = "";
    try {
      for await (const chunk of options.chatModel.streamChat({
        model: options.model,
        temperature: options.chatOptions.temperature,
        maxTokens: options.chatOptions.maxTokens,
        messages: [
          { role: "system", content: clarificationPrompt() },
          ...(options.chatHistory ?? []).map((message) => ({ ...message })),
          { role: "user", content: question },
        ],
        ...(options.signal ? { signal: options.signal } : {}),
      })) {
        reply += chunk.content;
      }
    } catch (error) {
      if ((error as { name?: unknown }).name === "AbortError") throw error;
      return {
        kind: "ready",
        assumptions: [NO_CLARIFICATION_ASSUMPTION],
        failed: true,
        language: null,
      };
    }
    return parseClarification(reply);
  }
}
