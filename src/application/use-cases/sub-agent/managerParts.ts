import type {
  SubAgentDelegationGrant,
  SubAgentSessionManagerContext,
} from "@application/ports/subAgent";
import type { ImportedSubAgentRunOutcome } from "@core/research";
import type { ParentFences } from "./parentFences";
import type { SubAgentStateStore } from "./SubAgentStateStore";

export interface SubAgentSessionOptions {
  grant: SubAgentDelegationGrant;
  resources: readonly string[];
  maxSearches: number;
}

export interface SubAgentManagerParts {
  context: SubAgentSessionManagerContext;
  store: SubAgentStateStore;
  fences: ParentFences;
  sessionOptions: Map<string, SubAgentSessionOptions>;
  outcomes: Map<string, ImportedSubAgentRunOutcome>;
  unsavedImports: Set<string>;
  notifyResults(): void;
}

/** Returns the context clock as the ISO timestamp stored on records. */
export function timestamp(parts: SubAgentManagerParts): string {
  return parts.context.now().toISOString();
}
