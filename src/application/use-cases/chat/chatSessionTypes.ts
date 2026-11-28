import type { ChatDisplayMessage } from "@core/conversation";
import type { ClarificationReply, ResearchAnswer } from "@core/answer";
import type {
  ConversationSourceRegistry,
  ConversationRegistryPromptView,
} from "@core/chat/sourceRegistry";
import type { SavedChatDeepResearch, SavedChatSettings } from "@core/chat/savedChat";
import type { ResearchActivity, ResearchTurnInput } from "@core/research/deepResearch";
import type { ChatSessionStatus, InterruptionReason } from "@core/chat/chatSession";
import type { ResearchService } from "@application/use-cases/research";
import type { SubAgentDispatchEntry, SubAgentNoticeEntry } from "@core/research";
import type {
  SubAgentSessionManagerFactory,
  SubAgentSessionRepository,
} from "@application/ports/subAgent";

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
  researchActivity: ResearchActivity | null;
  startedAt: string | null;
  completedAt: string | null;
  unreadCompletion: boolean;
  interruptionReason: InterruptionReason | null;
  subAgentDispatches: readonly SubAgentDispatchEntry[];
  subAgentNotices: readonly SubAgentNoticeEntry[];
  timelineSequence: number;
  recoveredFromPrevious: boolean;
  deepResearch?: SavedChatDeepResearch;
}

export type ChatSessionChangeKind =
  "status" | "messages" | "active-message" | "progress" | "answer" | "error" | "sub-agents";

export interface ChatSessionChange {
  sessionId: string;
  chatId: string | null;
  kind: ChatSessionChangeKind;
  error?: unknown;
}

export type ChatSessionListener = (change: ChatSessionChange) => void;

export type ChatSessionViewProbe = () => string | null;

export interface ChatRunRequest {
  question: string;
  chatHistory: ChatDisplayMessage[];
  appendQuestion: boolean;
  contextPaths: string[];
  activeFilePath?: string;
  includeActiveFile: boolean;
  includeContextDiagnostics: boolean;
  modelLabel: string;
  research?: ResearchTurnInput;
  thinking?: true;
  clarificationReply?: ClarificationReply;
}

export interface ChatSubAgentServices {
  repository: SubAgentSessionRepository;
  redact(text: string, key?: string): string;
  isDebugCapture?(): boolean;
  monotonicNow?(): number;
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
  createSubAgentSessionManager?: SubAgentSessionManagerFactory;
  subAgentServices?: ChatSubAgentServices;
  scheduleTimeout?(callback: () => void, delayMs: number): { cancel(): void };
  releaseAgentSessions?(sessionIds: readonly string[]): void;
  retireAgentSession?(sessionId: string): void;
}
