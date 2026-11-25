import type { Translate } from "@adapters/i18n";
import type { ResearchExportController } from "./researchExportController";
import type { ResearchSectionView, ResearchTurnInput } from "@core/research/deepResearch";
import type { ResearchPlanEditRequest, ResearchPlanEditResult } from "@application/use-cases/chat";

export interface ResearchCardContext {
  view: ResearchSectionView;
  t: Translate;
  sentTurns: Set<string>;
  expandedBranches?: Set<string>;
  latestRevisions?: ReadonlyMap<string, number>;
  running?: boolean;
  onTurn(input: ResearchTurnInput, label: string): void;
  onEditPlan?(request: ResearchPlanEditRequest): Promise<ResearchPlanEditResult>;
  exports?: ResearchExportController;
  onOpenSubAgentSession?(sessionId: string): void;
}
