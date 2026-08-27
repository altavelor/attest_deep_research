import type { ChatDisplayMessage } from "@core/conversation";
import type { ResearchAnswer } from "@core/answer";
import type {
  ConversationSourceRegistry,
  ConversationRegistryPromptView,
} from "@core/chat/sourceRegistry";
import type { SavedChatSettings } from "@core/chat/savedChat";
import type { ChatSessionStatus, InterruptionReason } from "@core/chat/chatSession";
import type { ResearchService } from "@application/use-cases/research";

export interface ChatSessionState {
  sessionId: string;
  chatId: string | null;
  status: ChatSessionStatus;
  activeRunId: string | null;
  messages: ChatDisplayMessage[];
  lastAnswer: ResearchAnswer | null;
  sourceRegistry: ConversationSourceRegistry;
  attachedContextPaths: string[];
  chatSettings: SavedChatSettings;
  draft: string;
  progressLabel: string | null;
  startedAt: string | null;
  completedAt: string | null;
  unreadCompletion: boolean;
  interruptionReason: InterruptionReason | null;
}

export type ChatSessionChangeKind =
  "status" | "messages" | "active-message" | "progress" | "answer" | "error";

export interface ChatSessionChange {
  sessionId: string;
  chatId: string | null;
  kind: ChatSessionChangeKind;
  error?: unknown;
}

export type ChatSessionListener = (change: ChatSessionChange) => void;

export interface ChatRunRequest {
  question: string;
  chatHistory: ChatDisplayMessage[];
  appendQuestion: boolean;
  contextPaths: string[];
  activeFilePath?: string;
  includeActiveFile: boolean;
  includeContextDiagnostics: boolean;
  modelLabel: string;
}

export interface ChatSessionEnvironment {
  createResearchService(settings: SavedChatSettings): ResearchService;
  now(): Date;
  createRunId(): string;
  buildRegistryPromptView?(
    registry: ConversationSourceRegistry,
    question: string,
  ): ConversationRegistryPromptView;
  logError?(error: unknown): void;
}
