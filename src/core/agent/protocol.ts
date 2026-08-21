import { ChatToolCall, ChatToolChoice, ChatToolDefinition } from "./tool";

export type ApiFormat = "openai-compatible" | "ollama" | "anthropic";
export type ChatApiProtocol = "chat-completions" | "responses";
export type LocalModelProvider = ApiFormat;

export interface ReasoningCapabilities {
  enabled: boolean;
  continuation: boolean;
  summary: boolean;
}

export interface ProviderContinuationState {
  readonly provider: ApiFormat;
  dispose(): void;
}

export type ModelOutputItem =
  | { type: "text"; text: string }
  | { type: "reasoningSummary"; text: string }
  | { type: "toolCall"; call: ChatToolCall };

export interface ModelRoundResult {
  items: ModelOutputItem[];
  continuation?: ProviderContinuationState;
  stopReason: "complete" | "tool_calls" | "length" | "error";
  usage?: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
  };
  reasoningItemCount?: number;
}

export interface ModelToolOutput {
  callId: string;
  output: string;
}

export type ModelStreamEvent =
  | { type: "reasoning-start"; segmentId: string; visibility: "text" | "summary" }
  | { type: "reasoning-delta"; segmentId: string; text: string }
  | { type: "reasoning-end"; segmentId: string }
  | { type: "text-delta"; text: string }
  | {
      type: "tool-call-delta";
      index: number;
      id?: string;
      name?: string;
      argumentsText?: string;
    }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      reasoningTokens: number;
    }
  | { type: "complete"; stopReason: "complete" | "tool_calls" | "length" | "error" };

export type ModelRoundDelta =
  { type: "text"; text: string } | { type: "reasoningSummary"; text: string; segmentId?: string };

export interface ModelRoundRequest extends ChatRequest {
  continuation?: ProviderContinuationState;
  toolOutputs?: ModelToolOutput[];
  reasoning?: {
    enabled: boolean;
    effort?: string;
    summary: "off" | "auto";
  };
  onEvent?(event: ModelStreamEvent): void;
  onDelta?(delta: ModelRoundDelta): void;
}

export interface ModelRoundProvider {
  listModels(): Promise<string[]>;
  runRound(request: ModelRoundRequest): Promise<ModelRoundResult>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ChatToolCall[];
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ChatToolDefinition[];
  toolChoice?: ChatToolChoice;
  parallelToolCalls?: boolean;
  reasoningEnabled?: boolean;

  reasoningEffort?: string;
  signal?: AbortSignal;
}

export interface ChatResponseChunk {
  content: string;
  isComplete: boolean;
  toolCalls?: ChatToolCall[];
  events?: ModelStreamEvent[];
}

export interface ChatModelProvider {
  listModels(): Promise<string[]>;
  streamChat(request: ChatRequest): AsyncIterable<ChatResponseChunk>;
}

export interface EmbeddingRequest {
  model: string;
  input: string[];
  signal?: AbortSignal;
}

export interface EmbeddingResponse {
  model: string;
  embeddings: number[][];
}

export interface EmbeddingProviderClient {
  listModels(): Promise<string[]>;
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}
