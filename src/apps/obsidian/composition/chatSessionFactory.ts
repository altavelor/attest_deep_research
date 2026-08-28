import { ChatSessionManager } from "@application/use-cases/chat";
import type { ChatRepository } from "@application/ports";
import type { ResearchService, ResearchSearchMode } from "@application/use-cases/research";
import type { SavedChatSettings } from "@core/chat/savedChat";
import { selectConversationRegistryPromptView } from "@core/chat/sourceRegistry";

export interface ChatSessionFactoryOptions {
  repository: ChatRepository;
  createResearchService(
    chatModelProfileId?: string,
    indexProfileId?: string,
    searchMode?: ResearchSearchMode,
  ): ResearchService;
  persistDiagnostics(): boolean;
  logError(error: unknown): void;
}

let runSequence = 0;

function createRunId(): string {
  runSequence += 1;
  return `${Date.now().toString(36)}-${runSequence.toString(36)}`;
}

/** Builds the plugin-owned chat session manager and its platform-neutral environment. */
export function createChatSessionManager(options: ChatSessionFactoryOptions): ChatSessionManager {
  return new ChatSessionManager({
    repository: options.repository,
    persistDiagnostics: options.persistDiagnostics,
    environment: {
      createResearchService: (settings: SavedChatSettings) =>
        options.createResearchService(
          settings.chatModelProfileId,
          settings.indexProfileId,
          settings.searchMode,
        ),
      now: () => new Date(),
      createRunId,
      buildRegistryPromptView: (registry, question) =>
        selectConversationRegistryPromptView(registry, question),
      logError: options.logError,
    },
  });
}
