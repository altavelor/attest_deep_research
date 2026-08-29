import {
  CHECK_URLS_TOOL,
  DOWNLOAD_DOCUMENT_TOOL,
  FIND_CLAIMS_TOOL,
  GET_ACTIVE_NOTE_TOOL,
  IMAGE_SEARCH_TOOL,
  INDEX_SEARCH_TOOL,
  LIST_INDEX_URLS_TOOL,
  MAP_SOURCES_TOOL,
  NOTE_MUTATION_TOOLS,
  PRESENT_CHART_TOOL,
  PROBE_DOCUMENT_URL_TOOL,
  READ_NOTE_TOOL,
  SUB_AGENT_TOOL,
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
} from "@core/agent/toolNames";

export type ToolSet = ReadonlySet<string>;

export interface PromptCapabilities {
  tools: ToolSet;
  web: boolean;
  webFetch: boolean;
  index: boolean;
  indexUrlAudit: boolean;
  noteRead: boolean;
  noteMutation: boolean;
  download: boolean;
  downloadProbe: boolean;
  subAgent: boolean;
  mapSources: boolean;
  findClaims: boolean;
  richMedia: boolean;
  imageSearch: boolean;

  parallelToolCalls: boolean;
}

export interface PromptCapabilityInput {
  availableTools: readonly string[];

  parallelToolCalls?: boolean;
}

/** Derives the capability flags the prompt branches on from the registered tool names. */
export function resolvePromptCapabilities(input: PromptCapabilityInput): PromptCapabilities {
  const tools: ToolSet = new Set(input.availableTools);
  return {
    tools,
    web: tools.has(WEB_SEARCH_TOOL),
    webFetch: tools.has(WEB_FETCH_TOOL),
    index: tools.has(INDEX_SEARCH_TOOL),
    indexUrlAudit: tools.has(LIST_INDEX_URLS_TOOL) || tools.has(CHECK_URLS_TOOL),
    noteRead: tools.has(READ_NOTE_TOOL) || tools.has(GET_ACTIVE_NOTE_TOOL),
    noteMutation: NOTE_MUTATION_TOOLS.some((name) => tools.has(name)),
    download: tools.has(DOWNLOAD_DOCUMENT_TOOL),
    downloadProbe: tools.has(PROBE_DOCUMENT_URL_TOOL),
    subAgent: tools.has(SUB_AGENT_TOOL),
    mapSources: tools.has(MAP_SOURCES_TOOL),
    findClaims: tools.has(FIND_CLAIMS_TOOL),
    richMedia: tools.has(PRESENT_CHART_TOOL),
    imageSearch: tools.has(IMAGE_SEARCH_TOOL),
    parallelToolCalls: input.parallelToolCalls === true,
  };
}

/** Keeps only the names the profile actually registered, preserving the given order. */
export function registered(tools: ToolSet, names: readonly string[]): string[] {
  return names.filter((name) => tools.has(name));
}
