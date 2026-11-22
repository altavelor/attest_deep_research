import { FileChatRepository } from "@adapters/filesystem/FileChatRepository";
import { ChatDocumentSubAgentRepository } from "@adapters/filesystem/sub-agent/ChatDocumentSubAgentRepository";
import type { ResearchRequest } from "@application/contracts/research";
import type { SubAgentSessionManagerContext } from "@application/ports/subAgent";
import { ChatSessionManager, type ChatRunRequest } from "@application/use-cases/chat";
import { createSubAgentSessionManager } from "@application/use-cases/sub-agent";
import { selectConversationRegistryPromptView } from "@core/chat/sourceRegistry";
import { settle } from "./async";
import { gatedResearch } from "./chatSessions";
import type { MemoryFileSystem } from "./memoryFileSystem";
import type { FakeSubAgentExecution } from "./subAgentSessions";

/** Builds a chat session manager whose sub-agent host is the real manager over the file system; the manager's context is handed to the caller. */
export function realSubAgentChat(
  fileSystem: MemoryFileSystem,
  onManagerContext: (context: SubAgentSessionManagerContext) => void = () => undefined,
) {
  const repository = new FileChatRepository({ fileSystem, folder: "chats" });
  const research = gatedResearch();
  let ids = 0;
  const manager = new ChatSessionManager({
    repository,
    persistDiagnostics: () => false,
    environment: {
      createResearchService: research.service,
      now: () => new Date("2026-10-26T10:00:00.000Z"),
      createRunId: () => `run-${(ids += 1)}`,
      buildRegistryPromptView: (registry, question) =>
        selectConversationRegistryPromptView(registry, question),
      createSubAgentSessionManager: (context) => {
        onManagerContext(context);
        return createSubAgentSessionManager(context);
      },
      subAgentServices: {
        repository: new ChatDocumentSubAgentRepository(repository),
        redact: (text) => text,
      },
    },
  });
  return { manager, repository, research };
}

/** Starts a Thinking turn of the chat and binds the fake child execution to it. */
export async function startTurn(
  chat: ReturnType<typeof realSubAgentChat>,
  sessionId: string,
  question: string,
  execution: FakeSubAgentExecution,
): Promise<{ request: ResearchRequest; index: number; runId: string }> {
  const run: ChatRunRequest = {
    question,
    chatHistory: [],
    appendQuestion: true,
    contextPaths: [],
    includeActiveFile: false,
    includeContextDiagnostics: false,
    modelLabel: "Model",
  };
  await chat.manager.start(sessionId, run);
  await settle();
  const index = chat.research.requests.length - 1;
  const request = chat.research.requests[index]!;
  request.subAgentParent!.bindExecution(execution);
  return { request, index, runId: request.subAgentParent!.parentRunId };
}

/** Completes a started turn and waits for its terminal save. */
export async function endTurn(chat: ReturnType<typeof realSubAgentChat>, index: number) {
  chat.research.emit(index, {
    type: "complete",
    answer: { question: "Q", answer: "A", citations: [], followUpQuestions: [], createdAt: "t" },
  });
  chat.research.end(index);
  await settle();
}

/** Starts a Deep Research continue turn of the chat; the returned request carries its research context. */
export async function startResearchTurn(
  chat: ReturnType<typeof realSubAgentChat>,
  sessionId: string,
  researchId: string,
): Promise<{ request: ResearchRequest; index: number }> {
  const run: ChatRunRequest = {
    question: "Continue",
    chatHistory: [],
    appendQuestion: true,
    contextPaths: [],
    includeActiveFile: false,
    includeContextDiagnostics: false,
    modelLabel: "Model",
    research: { type: "continue", researchId },
  };
  await chat.manager.start(sessionId, run);
  await settle();
  const index = chat.research.requests.length - 1;
  return { request: chat.research.requests[index]!, index };
}
