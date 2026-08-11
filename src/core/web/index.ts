export { rankSectionsByQuery, splitIntoSections } from "./sectionRanking";
export type { RankedSection, SectionRankingOptions } from "./sectionRanking";

export {
  WEB_SOURCE_CATALOG,
  DUCKDUCKGO_DESCRIPTOR,
  findWebSourceDescriptor,
  areCredentialsComplete,
  IMAGE_SOURCE_IDS,
  isImageSourceId,
  isWebSourceActivation,
  isWebSourceActive,
  OPENVERSE_SOURCE_ID,
  WEB_SOURCE_ACTIVATIONS,
  WIKIMEDIA_COMMONS_SOURCE_ID,
} from "./webSources";

export { selectWebSources } from "./sourceSelection";
export { assessWebTextQuality, canonicalizeWebEvidenceUrl } from "./evidenceQuality";
export type { WebTextQualityAssessment } from "./evidenceQuality";
export type {
  WebSelectionMode,
  WebSourceCandidate,
  WebSourceExclusion,
  WebSourceExclusionReason,
  WebSourceSelection,
  WebSourceSelectionEntry,
  WebSourceSelectionInput,
} from "./sourceSelection";

export {
  classifyWebQuery,
  mergeRankedResults,
  isWebQueryIntent,
  WEB_QUERY_INTENTS,
} from "./queryPlanning";
export type { WebQueryIntent } from "./queryPlanning";

export {
  WEB_QUERY_RECENCIES,
  isWebQueryRecency,
  inferQueryRecency,
  recencyFloor,
  detectQueryLanguage,
  extractSiteFilters,
  stripTemporalNoise,
} from "./queryContext";
export type { WebQueryRecency, WebQueryLanguage, SiteFilterExtraction } from "./queryContext";
export type {
  WebSourceActivation,
  WebSourceCategory,
  WebSourceCapabilities,
  WebSourceCredentialField,
  WebSourceDescriptor,
  WebSourceProfile,
} from "./webSources";
