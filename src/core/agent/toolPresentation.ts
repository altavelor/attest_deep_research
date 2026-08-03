import {
  CHECK_URLS_TOOL,
  CREATE_NOTE_TOOL,
  DELETE_NOTE_TOOL,
  DOWNLOAD_DOCUMENT_TOOL,
  FIND_CLAIMS_TOOL,
  FIND_IN_INDEX_TOOL,
  GET_ACTIVE_NOTE_TOOL,
  GET_INDEX_SOURCE_OUTLINE_TOOL,
  GET_SOURCE_METADATA_TOOL,
  GET_SOURCE_SUMMARY_TOOL,
  IMAGE_SEARCH_TOOL,
  INDEX_SEARCH_TOOL,
  LIST_INDEX_CHUNKS_TOOL,
  LIST_INDEX_SOURCES_TOOL,
  LIST_INDEX_URLS_TOOL,
  LIST_NOTES_TOOL,
  LIST_SHARED_REFERENCES_TOOL,
  MAP_SOURCES_TOOL,
  PRESENT_CHART_TOOL,
  PRESENT_IMAGE_GALLERY_TOOL,
  PROBE_DOCUMENT_URL_TOOL,
  READ_INDEX_CHUNK_TOOL,
  READ_INDEX_SECTION_TOOL,
  READ_NOTE_TOOL,
  SEARCH_INDEX_BY_METADATA_TOOL,
  SEARCH_NOTES_TOOL,
  SUB_AGENT_TOOL,
  SUMMARIZE_INDEX_SOURCE_TOOL,
  UPDATE_NOTE_TOOL,
  WEB_FETCH_SECTION_TOOL,
  WEB_FETCH_TOOL,
  WEB_FETCH_URL_TOOL,
  WEB_PAGE_METADATA_TOOL,
  WEB_SEARCH_TOOL,
} from "./toolNames";

export interface ToolIntentContext {
  args: Record<string, unknown>;

  searchSources?: readonly string[];

  fetchTargetCount?: number;
}

export interface ToolPresentation {
  title: string;

  intent(context: ToolIntentContext): string;
}

const MAX_INTENT_CHARS = 80;

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function count(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  return Array.isArray(value) ? value.length : 0;
}

function truncate(value: string, max = MAX_INTENT_CHARS): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function quoted(value: string): string {
  return `“${truncate(value)}”`;
}

function basename(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.endsWith(".md") ? last.slice(0, -3) : last;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return truncate(url, 40);
  }
}

/** Names a document by its readable title, falling back to its path or id. */
function documentLabel(args: Record<string, unknown>): string {
  const path = str(args, "sourcePath") || str(args, "path") || str(args, "documentPath");
  if (path) return basename(path);
  const id = str(args, "sourceId") || str(args, "chunkId") || str(args, "evidenceId");
  return id ? truncate(id, 24) : "";
}

function ofDocument(args: Record<string, unknown>, whenUnknown: string, template: string): string {
  const label = documentLabel(args);
  return label ? template.replace("%s", quoted(label)) : whenUnknown;
}

function describeSearchScope(args: Record<string, unknown>): string {
  const prefix = str(args, "prefix");
  const limit = typeof args.limit === "number" ? args.limit : undefined;
  const parts = [
    ...(prefix ? [`under ${quoted(prefix)}`] : []),
    ...(limit ? [`top ${limit}`] : []),
  ];
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

export const TOOL_PRESENTATIONS: Readonly<Record<string, ToolPresentation>> = {
  [INDEX_SEARCH_TOOL]: {
    title: "Search index",
    intent: ({ args }) => {
      const query = str(args, "query");
      const scope = describeSearchScope(args);
      return query
        ? `Searching the vault for ${quoted(query)}${scope}`
        : `Searching the vault${scope}`;
    },
  },
  [SEARCH_NOTES_TOOL]: {
    title: "Search notes",
    intent: ({ args }) => {
      const query = str(args, "query");
      const scope = describeSearchScope(args);
      return query
        ? `Searching the vault for ${quoted(query)}${scope}`
        : `Searching the vault${scope}`;
    },
  },
  [WEB_SEARCH_TOOL]: {
    title: "Search web",
    intent: ({ args, searchSources }) => {
      const query = str(args, "query");
      const top = typeof args.count === "number" ? ` (top ${args.count})` : "";
      const resource =
        searchSources && searchSources.length > 0 ? searchSources.join(", ") : "the web";
      return query ? `Searching ${resource} for ${quoted(query)}${top}` : `Searching ${resource}`;
    },
  },
  [WEB_FETCH_TOOL]: {
    title: "Fetch web page",
    intent: ({ args, fetchTargetCount = 0 }) => {
      const pages = count(args, "resultIds") || fetchTargetCount;
      const noun = pages === 1 ? "page" : "pages";
      if (fetchTargetCount > 0) return `Fetching ${noun} ${pages}:`;
      return pages > 0 ? `Fetching ${noun} ${pages}` : "Fetching pages";
    },
  },
  [WEB_FETCH_URL_TOOL]: {
    title: "Fetch page",
    intent: ({ args }) => {
      const url = str(args, "url");
      return url ? `Fetching ${hostOf(url)}` : "Fetching a page";
    },
  },
  [WEB_FETCH_SECTION_TOOL]: {
    title: "Fetch section",
    intent: ({ args }) => {
      const query = str(args, "query");
      return query
        ? `Reading the part of the page about ${quoted(query)}`
        : "Reading the relevant part of the page";
    },
  },
  [WEB_PAGE_METADATA_TOOL]: {
    title: "Page details",
    intent: ({ args }) => {
      const url = str(args, "url");
      return url ? `Reading title and author of ${hostOf(url)}` : "Reading page details";
    },
  },
  [LIST_INDEX_SOURCES_TOOL]: {
    title: "Index sources",
    intent: () => "Listing the documents in the index",
  },
  [LIST_INDEX_CHUNKS_TOOL]: {
    title: "Index fragments",
    intent: ({ args }) => ofDocument(args, "Listing indexed fragments", "Listing fragments of %s"),
  },
  [READ_INDEX_CHUNK_TOOL]: {
    title: "Read fragment",
    intent: ({ args }) =>
      ofDocument(args, "Reading an indexed fragment", "Reading a fragment of %s"),
  },
  [READ_INDEX_SECTION_TOOL]: {
    title: "Read section",
    intent: ({ args }) => {
      const heading = str(args, "heading") || str(args, "sectionId");
      if (heading) return `Reading the section ${quoted(heading)}`;
      return ofDocument(args, "Reading a section", "Reading a section of %s");
    },
  },
  [FIND_IN_INDEX_TOOL]: {
    title: "Find in index",
    intent: ({ args }) => {
      const query = str(args, "query") || str(args, "text");
      return query ? `Looking for ${quoted(query)} across the index` : "Looking through the index";
    },
  },
  [GET_INDEX_SOURCE_OUTLINE_TOOL]: {
    title: "Document outline",
    intent: ({ args }) =>
      ofDocument(args, "Reading a document outline", "Reading the outline of %s"),
  },
  [SUMMARIZE_INDEX_SOURCE_TOOL]: {
    title: "Summarize document",
    intent: ({ args }) => ofDocument(args, "Summarizing a document", "Summarizing %s"),
  },
  [SEARCH_INDEX_BY_METADATA_TOOL]: {
    title: "Search by metadata",
    intent: ({ args }) => {
      const author = str(args, "author");
      const year = str(args, "year") || (typeof args.year === "number" ? String(args.year) : "");
      const facets = [
        ...(author ? [`author ${quoted(author)}`] : []),
        ...(year ? [`year ${year}`] : []),
      ];
      return facets.length > 0
        ? `Searching the index by ${facets.join(" and ")}`
        : "Searching the index by document details";
    },
  },
  [GET_SOURCE_METADATA_TOOL]: {
    title: "Document details",
    intent: ({ args }) => ofDocument(args, "Reading document details", "Reading details of %s"),
  },
  [GET_SOURCE_SUMMARY_TOOL]: {
    title: "Document summary",
    intent: ({ args }) =>
      ofDocument(args, "Reading a document summary", "Reading the summary of %s"),
  },
  [LIST_SHARED_REFERENCES_TOOL]: {
    title: "Shared references",
    intent: () => "Finding sources cited by several documents",
  },
  [FIND_CLAIMS_TOOL]: {
    title: "Find claims",
    intent: ({ args }) => {
      const topic = str(args, "query") || str(args, "topic") || str(args, "claim");
      return topic ? `Looking for claims about ${quoted(topic)}` : "Looking for conflicting claims";
    },
  },
  [LIST_INDEX_URLS_TOOL]: {
    title: "Index links",
    intent: ({ args }) =>
      ofDocument(args, "Listing links found in the index", "Listing links found in %s"),
  },
  [CHECK_URLS_TOOL]: {
    title: "Check links",
    intent: ({ args }) => {
      const urls = count(args, "urls");
      return urls > 0 ? `Checking ${urls} ${urls === 1 ? "link" : "links"}` : "Checking links";
    },
  },
  [PROBE_DOCUMENT_URL_TOOL]: {
    title: "Check document",
    intent: ({ args }) => {
      const urls = count(args, "urls") || (str(args, "url") ? 1 : 0);
      return urls > 1
        ? `Checking whether ${urls} links are downloadable documents`
        : "Checking whether the link is a downloadable document";
    },
  },
  [DOWNLOAD_DOCUMENT_TOOL]: {
    title: "Download document",
    intent: ({ args }) => {
      const path = str(args, "path");
      const url = str(args, "url");
      if (path) return `Saving ${quoted(basename(path))} to the vault`;
      return url
        ? `Saving a document from ${hostOf(url)} to the vault`
        : "Saving a document to the vault";
    },
  },
  [READ_NOTE_TOOL]: {
    title: "Read note",
    intent: ({ args }) => {
      const path = str(args, "path");
      return path ? `Reading the note ${quoted(basename(path))}` : "Reading a note";
    },
  },
  [GET_ACTIVE_NOTE_TOOL]: {
    title: "Active note",
    intent: () => "Reading the currently active note",
  },
  [LIST_NOTES_TOOL]: {
    title: "List notes",
    intent: ({ args }) => {
      const prefix = str(args, "prefix");
      return prefix ? `Listing notes under ${quoted(prefix)}` : "Listing all notes in the vault";
    },
  },
  [CREATE_NOTE_TOOL]: {
    title: "Create note",
    intent: ({ args }) => {
      const path = str(args, "path");
      const size = typeof args.content === "string" ? ` (${args.content.length} chars)` : "";
      return path ? `Creating the note ${quoted(basename(path))}${size}` : "Creating a note";
    },
  },
  [UPDATE_NOTE_TOOL]: {
    title: "Edit note",
    intent: ({ args }) => {
      const path = str(args, "path");
      return path ? `Editing the note ${quoted(basename(path))}` : "Editing a note";
    },
  },
  [DELETE_NOTE_TOOL]: {
    title: "Delete note",
    intent: ({ args }) => {
      const path = str(args, "path");
      return path ? `Deleting the note ${quoted(basename(path))}` : "Deleting a note";
    },
  },
  [SUB_AGENT_TOOL]: {
    title: "Sub-agent",
    intent: ({ args }) => {
      const task = str(args, "task");
      return task ? `Delegating to a sub-agent: ${quoted(task)}` : "Running a sub-agent";
    },
  },
  [MAP_SOURCES_TOOL]: {
    title: "Fan-out over sources",
    intent: ({ args }) => {
      const question = str(args, "question");
      return question
        ? `Asking ${quoted(question)} of each document`
        : "Asking each document the same question";
    },
  },
  [IMAGE_SEARCH_TOOL]: {
    title: "Search images",
    intent: ({ args }) => {
      const query = str(args, "query");
      return query ? `Looking for images of ${quoted(query)}` : "Looking for images";
    },
  },
  [PRESENT_IMAGE_GALLERY_TOOL]: {
    title: "Show images",
    intent: ({ args }) => {
      const images = count(args, "imageIds");
      const title = str(args, "title");
      if (title) return `Adding the gallery ${quoted(title)} to the answer`;
      return images > 0
        ? `Adding ${images} ${images === 1 ? "image" : "images"} to the answer`
        : "Adding images to the answer";
    },
  },
  [PRESENT_CHART_TOOL]: {
    title: "Show chart",
    intent: ({ args }) => {
      const title = str(args, "title");
      const kind = str(args, "chartType");
      const shape = kind ? `${kind} chart` : "chart";
      return title ? `Drawing the ${shape} ${quoted(title)}` : `Drawing a ${shape}`;
    },
  },
};

export function toolPresentation(name: string): ToolPresentation | undefined {
  return TOOL_PRESENTATIONS[name];
}

/** Bold heading for a call; unregistered tools get a humanized name. */
export function toolTitle(name: string): string {
  return TOOL_PRESENTATIONS[name]?.title ?? humanizeToolName(name);
}

/** Undefined when the tool has no entry, so callers can fall back to a label. */
export function toolIntent(name: string, context: ToolIntentContext): string | undefined {
  return TOOL_PRESENTATIONS[name]?.intent(context);
}

/**
 * Last-resort rendering of a raw tool name: `search_images` → "Search images".
 * Keeps an unregistered tool from leaking snake_case into the transcript.
 */
export function humanizeToolName(name: string): string {
  const words = name.replace(/[_-]+/g, " ").trim();
  if (!words) return name;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
