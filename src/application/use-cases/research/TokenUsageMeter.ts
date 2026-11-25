import type {
  ChatModelProvider,
  ChatRequest,
  ChatResponseChunk,
  ModelRoundProvider,
  ModelRoundRequest,
  ModelRoundResult,
} from "@core/agent";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StageTokenUsage extends TokenUsage {
  stage: string;
}

const FIRST_STAGE = "gathering";

/**
 * Counts the input and output tokens the model providers of one answer report, in total and per
 * stage of the answer. Wrapped providers add the usage their streams or rounds report; counts that
 * are not non-negative safe integers are ignored.
 */
export class TokenUsageMeter {
  private usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  private reported = false;
  private stage = FIRST_STAGE;
  private stages = new Map<string, TokenUsage>();

  reset(): void {
    this.usage = { inputTokens: 0, outputTokens: 0 };
    this.reported = false;
    this.stage = FIRST_STAGE;
    this.stages = new Map();
  }

  /** Charges later usage to the named stage. */
  enter(stage: string): void {
    this.stage = stage;
  }

  add(usage: { inputTokens?: unknown; outputTokens?: unknown } | null | undefined): void {
    if (!usage) return;
    const input = count(usage.inputTokens);
    const output = count(usage.outputTokens);
    if (input === null && output === null) return;
    this.reported = true;
    this.usage = sum(this.usage, input, output);
    const stage = this.stages.get(this.stage) ?? { inputTokens: 0, outputTokens: 0 };
    this.stages.set(this.stage, sum(stage, input, output));
  }

  /** Returns the counted usage of each stage that reported any, in the order the stages began. */
  byStage(): StageTokenUsage[] {
    return [...this.stages].map(([stage, usage]) => ({ stage, ...usage }));
  }

  /** Returns the counted usage, or null when no provider reported any. */
  total(): TokenUsage | null {
    return this.reported ? { ...this.usage } : null;
  }

  chatModel(provider: ChatModelProvider): ChatModelProvider {
    const add = (usage: TokenUsage): void => this.add(usage);
    return {
      listModels: () => provider.listModels(),
      async *streamChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
        for await (const chunk of provider.streamChat(request)) {
          for (const event of chunk.events ?? []) if (event.type === "usage") add(event);
          yield chunk;
        }
      },
    };
  }

  roundProvider(provider: ModelRoundProvider): ModelRoundProvider {
    return {
      listModels: () => provider.listModels(),
      runRound: async (request: ModelRoundRequest): Promise<ModelRoundResult> => {
        const result = await provider.runRound(request);
        this.add(result.usage);
        return result;
      },
    };
  }
}

function sum(usage: TokenUsage, input: number | null, output: number | null): TokenUsage {
  return {
    inputTokens: usage.inputTokens + (input ?? 0),
    outputTokens: usage.outputTokens + (output ?? 0),
  };
}

function count(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
}
