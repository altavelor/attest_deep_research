import type {
  SubAgentDelegationGrant,
  SubAgentSessionManagerContext,
} from "@application/ports/subAgent";
import type { ImportedSubAgentRunOutcome } from "@core/research";
import type { SubAgentImportCoordinator } from "./importCoordinator";
import type { SubAgentMainEvents } from "./mainEvents";
import type { SubAgentObservationRecorder } from "./observationRecorder";
import type { ParentFences } from "./parentFences";
import type { SubAgentBudgetCoordinator } from "./subAgentBudget";
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
  budget: SubAgentBudgetCoordinator;
  imports: SubAgentImportCoordinator;
  sessionOptions: Map<string, SubAgentSessionOptions>;
  outcomes: Map<string, ImportedSubAgentRunOutcome>;
  unsavedImports: Set<string>;
  observation: SubAgentObservationRecorder;
  mainEvents: SubAgentMainEvents;
  notifyResults(): void;
  notifyObservation(): void;
}

/** Returns the context clock as the ISO timestamp stored on records. */
export function timestamp(parts: SubAgentManagerParts): string {
  return parts.context.now().toISOString();
}
