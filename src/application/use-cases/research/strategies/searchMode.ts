import { ResearchExecutionStrategy } from "@core/diagnostics";
import { ResearchRequest, ResearchSearchMode } from "@application/contracts/research";

export function resolveSearchMode(request: ResearchRequest): ResearchSearchMode {
  return request.searchMode ?? (request.includeWebSearch === true ? "indexAndWeb" : "indexOnly");
}

export function selectResearchExecutionStrategy(
  forceEagerResearch: boolean,
): ResearchExecutionStrategy {
  return forceEagerResearch ? "eager-forced" : "eager-default";
}
