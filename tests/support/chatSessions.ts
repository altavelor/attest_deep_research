import { FileChatRepository } from "@adapters/filesystem/FileChatRepository";
import type { ChatRepository } from "@application/ports";
import type { ResearchRequest, ResearchStreamEvent } from "@application/contracts/research";
import type {
  SubAgentCloseResult,
  SubAgentDelegator,
  SubAgentHost,
  SubAgentInspectionPort,
  SubAgentSessionManagerContext,
  SubAgentSessionManagerFactory,
} from "@application/ports/subAgent";
import type { ParentRunBinding, ParentRunDeliveryContext } from "@core/research";
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
  createSubAgentSessionManager?: SubAgentSessionManagerFactory;
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
      ...(options.createSubAgentSessionManager
        ? {
            createSubAgentSessionManager: options.createSubAgentSessionManager,
            subAgentServices: { repository: { load: async () => null }, redact: (text) => text },
          }
        : {}),
    },
  });
  return { manager, repository };
}

/**
 * A child host that records the lifecycle calls a chat runtime makes on it, in order,
 * into a shared log. Its closeAll can be held open to model a slow archive drain.
 */
class FakeChildHost implements SubAgentHost {
  readonly bindings: {
    binding: ParentRunBinding;
    delivery: ParentRunDeliveryContext;
    delegator: SubAgentDelegator;
  }[] = [];
  closeGate: Promise<void> = Promise.resolve();

  constructor(
    readonly context: SubAgentSessionManagerContext,
    private readonly log: string[],
    readonly id: number,
  ) {}

  delegatorFor(binding: ParentRunBinding, delivery: ParentRunDeliveryContext): SubAgentDelegator {
    const delegator = {
      getResult: async () => Promise.reject(new Error("No children.")),
    } as unknown as SubAgentDelegator;
    this.bindings.push({ binding, delivery, delegator });
    this.log.push(`delegator:${binding.parentRunId}`);
    return delegator;
  }

  subscribeResults(): () => void {
    return () => undefined;
  }

  listRunRefs(): [] {
    return [];
  }

  inspection(): SubAgentInspectionPort {
    return {
      snapshot: async () => ({ revision: 0, activeCount: 0, hasAgentRuns: false, sessions: [] }),
      getSession: async () => null,
      subscribe: () => () => undefined,
      stopFromUser: async () => "stale",
    };
  }

  async closeAll(parentRunId: string, reason: string): Promise<SubAgentCloseResult> {
    this.log.push(`closeAll:${parentRunId}:${reason}`);
    await this.closeGate;
    if (reason === "plugin-unload") {
      await Promise.resolve().then(() =>
        this.context.mainEvents?.publish([
          {
            type: "notice",
            entry: {
              eventKey: `notice:${parentRunId}:interrupted`,
              parentRunId,
              description: "Child",
              createdAt: "t",
              sessionId: "child-1",
              runId: "child-run-1",
              kind: "interrupted",
              reasonCode: reason,
            },
          },
        ]),
      );
    }
    return { durable: true, recoveryMarkerPersisted: false, unsettledPermits: 0, failures: [] };
  }

  async dispose(): Promise<void> {
    this.log.push(`dispose:${this.id}`);
  }
}

/** Returns a manager factory that creates recording child hosts sharing one log. */
export function fakeChildHosts(log: string[] = []): {
  factory: SubAgentSessionManagerFactory;
  hosts: FakeChildHost[];
  log: string[];
} {
  const hosts: FakeChildHost[] = [];
  return {
    hosts,
    log,
    factory: (context) => {
      const host = new FakeChildHost(context, log, hosts.length);
      hosts.push(host);
      return host;
    },
  };
}

/** A research service whose runs stay open until the test emits events and ends them. */
export function gatedResearch(): {
  service: () => ResearchService;
  requests: ResearchRequest[];
  emit(index: number, event: ResearchStreamEvent): void;
  end(index: number): void;
} {
  const requests: ResearchRequest[] = [];
  const gates: { events: ResearchStreamEvent[]; ended: boolean; wake(): void }[] = [];
  return {
    requests,
    emit: (index, event) => {
      gates[index]!.events.push(event);
      gates[index]!.wake();
    },
    end: (index) => {
      gates[index]!.ended = true;
      gates[index]!.wake();
    },
    service: () =>
      ({
        answer: (request: ResearchRequest) => {
          requests.push(request);
          const gate = { events: [] as ResearchStreamEvent[], ended: false, wake: () => {} };
          gates.push(gate);
          return (async function* stream() {
            for (;;) {
              while (gate.events.length > 0) yield gate.events.shift()!;
              if (gate.ended) return;
              await new Promise<void>((resolve) => (gate.wake = resolve));
            }
          })();
        },
      }) as unknown as ResearchService,
  };
}
