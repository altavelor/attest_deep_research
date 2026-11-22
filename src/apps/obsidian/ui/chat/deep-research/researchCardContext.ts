import type { Translate } from "@adapters/i18n";
import type { ResearchSectionView, ResearchTurnInput } from "@core/research/deepResearch";

export interface ResearchCardContext {
  view: ResearchSectionView;
  t: Translate;
  sentTurns: Set<string>;
  running?: boolean;
  onTurn(input: ResearchTurnInput, label: string): void;
}
