import type { ResearchSectionView, ResearchState } from "@core/research/deepResearch";

export interface ResearchStatePort {
  read(): ResearchSectionView;
  commit(next: ResearchState, expectedRevision: number | null): Promise<void>;
}
