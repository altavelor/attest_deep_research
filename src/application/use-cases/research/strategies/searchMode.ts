import { ResearchRequest, ResearchSearchMode } from "@application/contracts/research";

export function resolveSearchMode(request: ResearchRequest): ResearchSearchMode {
  return request.searchMode ?? (request.includeWebSearch === true ? "indexAndWeb" : "indexOnly");
}
