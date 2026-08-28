import { FileChatRepository } from "@adapters/filesystem/FileChatRepository";
import type { ChatRepository } from "@application/ports";
import { ChatSessionManager, type ChatSessionEnvironment } from "@application/use-cases/chat";
import type { ResearchService } from "@application/use-cases/research";
import { selectConversationRegistryPromptView } from "@core/chat/sourceRegistry";
import { MemoryFileSystem } from "./memoryFileSystem";

export interface TestSessionManagerOptions {
  createResearchService?: ChatSessionEnvironment["createResearchService"];
  repository?: ChatRepository;
  now?: () => Date;
  persistDiagnostics?: boolean;
  logError?(error: unknown): void;
}

/** Builds a session manager over an in-memory chat repository for tests. */
export function createTestSessionManager(options: TestSessionManagerOptions = {}): {
  manager: ChatSessionManager;
  repository: ChatRepository;
} {
  const repository =
    options.repository ??
    new FileChatRepository({ fileSystem: new MemoryFileSystem(), folder: "chats" });
  let sequence = 0;
  const manager = new ChatSessionManager({
    repository,
    persistDiagnostics: () => options.persistDiagnostics === true,
    environment: {
      createResearchService:
        options.createResearchService ??
        ((): ResearchService => {
          throw new Error("The test must not start a research run.");
        }),
      now: options.now ?? (() => new Date("2026-01-01T00:00:00.000Z")),
      createRunId: () => {
        sequence += 1;
        return `run-${sequence}`;
      },
      buildRegistryPromptView: (registry, question) =>
        selectConversationRegistryPromptView(registry, question),
      ...(options.logError ? { logError: options.logError } : {}),
    },
  });
  return { manager, repository };
}
