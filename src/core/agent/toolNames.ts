// Canonical tool names — the single source of truth shared by tool definitions
// (adapters), the thinking prompt (core/research), and presence checks
// (application). Renaming a tool is a one-line change here that updates the tool's
// schema, its prompt guidance, and every `has(...)` gate at once — so the prompt
// can never advertise a tool the runtime does not register.
//
// Every registered research tool has a constant here. `PROMPT_TOOL_NAMES` (bottom)
// is the subset the thinking prompt may reference and drives the drift-guard test.

// --- Index evidence + inventory ---
export const INDEX_SEARCH_TOOL = "search_index";
export const LIST_INDEX_SOURCES_TOOL = "list_index_sources";
export const LIST_INDEX_CHUNKS_TOOL = "list_index_chunks";
export const READ_INDEX_CHUNK_TOOL = "read_index_chunk";
export const READ_INDEX_SECTION_TOOL = "read_index_section";
export const FIND_IN_INDEX_TOOL = "find_in_index";
export const SUMMARIZE_INDEX_SOURCE_TOOL = "summarize_index_source";
export const GET_INDEX_SOURCE_OUTLINE_TOOL = "get_index_source_outline";
export const SEARCH_INDEX_BY_METADATA_TOOL = "search_index_by_metadata";
export const GET_SOURCE_METADATA_TOOL = "get_source_metadata";
export const GET_SOURCE_SUMMARY_TOOL = "get_source_summary";
export const LIST_SHARED_REFERENCES_TOOL = "list_shared_references";
export const FIND_CLAIMS_TOOL = "find_claims";

// --- Index URL audit ---
export const LIST_INDEX_URLS_TOOL = "list_index_urls";
export const CHECK_URLS_TOOL = "check_urls";

// --- Web ---
export const WEB_SEARCH_TOOL = "search_web";
export const WEB_FETCH_TOOL = "fetch_web_page";
export const WEB_FETCH_URL_TOOL = "fetch_url";
export const WEB_FETCH_SECTION_TOOL = "fetch_web_section";
export const WEB_PAGE_METADATA_TOOL = "get_page_metadata";

// --- Rich answer media ---
export const IMAGE_SEARCH_TOOL = "search_images";
export const PRESENT_IMAGE_GALLERY_TOOL = "present_image_gallery";
export const PRESENT_CHART_TOOL = "present_chart";

// --- Universal sub-agent ---
export const SUB_AGENT_TOOL = "run_subagent";
/** Fan-out: one scoped sub-agent per document, reduced to an evidence matrix (SPEC-corpus R5). */
export const MAP_SOURCES_TOOL = "map_sources";

// --- Document download ---
export const PROBE_DOCUMENT_URL_TOOL = "probe_document_url";
export const DOWNLOAD_DOCUMENT_TOOL = "download_document";

// --- Note editing (read-only) ---
export const READ_NOTE_TOOL = "read_note";
export const SEARCH_NOTES_TOOL = "search_notes";
export const LIST_NOTES_TOOL = "list_notes";
export const GET_ACTIVE_NOTE_TOOL = "get_active_note";

// --- Note mutation (write) ---
export const CREATE_NOTE_TOOL = "create_note";
export const UPDATE_NOTE_TOOL = "update_note";
export const DELETE_NOTE_TOOL = "delete_note";

/** Web evidence tools, in the order they should be advertised. */
export const WEB_EVIDENCE_TOOLS = [WEB_SEARCH_TOOL, WEB_FETCH_TOOL] as const;
/** Note editing (read-only) tools. */
export const NOTE_EDIT_TOOLS = [
  SEARCH_NOTES_TOOL,
  READ_NOTE_TOOL,
  LIST_NOTES_TOOL,
  GET_ACTIVE_NOTE_TOOL,
] as const;
/** Note mutation (write) tools. */
export const NOTE_MUTATION_TOOLS = [CREATE_NOTE_TOOL, UPDATE_NOTE_TOOL, DELETE_NOTE_TOOL] as const;

/** Every tool name the thinking prompt may reference. Drives the drift guard test. */
export const PROMPT_TOOL_NAMES = [
  INDEX_SEARCH_TOOL,
  READ_INDEX_CHUNK_TOOL,
  READ_INDEX_SECTION_TOOL,
  GET_SOURCE_SUMMARY_TOOL,
  WEB_SEARCH_TOOL,
  WEB_FETCH_TOOL,
  SUB_AGENT_TOOL,
  MAP_SOURCES_TOOL,
  FIND_CLAIMS_TOOL,
  LIST_INDEX_URLS_TOOL,
  CHECK_URLS_TOOL,
  PROBE_DOCUMENT_URL_TOOL,
  DOWNLOAD_DOCUMENT_TOOL,
  IMAGE_SEARCH_TOOL,
  PRESENT_IMAGE_GALLERY_TOOL,
  PRESENT_CHART_TOOL,
  ...NOTE_EDIT_TOOLS,
  ...NOTE_MUTATION_TOOLS,
] as const;
