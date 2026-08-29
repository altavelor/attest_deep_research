import {
  CREATE_NOTE_TOOL,
  FIND_CLAIMS_TOOL,
  GET_ACTIVE_NOTE_TOOL,
  GET_SOURCE_SUMMARY_TOOL,
  IMAGE_SEARCH_TOOL,
  INDEX_SEARCH_TOOL,
  LIST_INDEX_SOURCES_TOOL,
  LIST_NOTES_TOOL,
  MAP_SOURCES_TOOL,
  PRESENT_CHART_TOOL,
  PRESENT_IMAGE_GALLERY_TOOL,
  READ_INDEX_CHUNK_TOOL,
  READ_NOTE_TOOL,
  SEARCH_NOTES_TOOL,
  SUB_AGENT_TOOL,
  UPDATE_NOTE_TOOL,
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
} from "@core/agent";
import { ARTIFACT_LIMITS } from "@core/media/artifacts";
import { PromptCapabilities, registered } from "./promptCapabilities";

function humanJoin(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** Level five: navigating and reading the vault when no evidence source is registered. */
export function buildVaultNavigationSection(capabilities: PromptCapabilities): string {
  const finders = registered(capabilities.tools, [SEARCH_NOTES_TOOL, LIST_NOTES_TOOL]);
  const readers = registered(capabilities.tools, [READ_NOTE_TOOL, GET_ACTIVE_NOTE_TOOL]);

  const lines = ["## Working with the vault"];
  if (finders.length > 0) {
    lines.push(
      `- ${humanJoin(finders)} locate notes: ${SEARCH_NOTES_TOOL} by keyword in the path, ` +
        `${LIST_NOTES_TOOL} by folder prefix.`,
    );
  }
  if (readers.length > 0) {
    lines.push(
      `- ${humanJoin(readers)} load note content` +
        (capabilities.tools.has(GET_ACTIVE_NOTE_TOOL)
          ? `, ${GET_ACTIVE_NOTE_TOOL} for the file open in Obsidian.`
          : ".") +
        " Read each relevant note before summarising and compose from what it says.",
    );
  }
  return lines.join("\n");
}

/** Level five: when delegating a facet pays for itself, and how to reuse its answer. */
export function buildSubAgentSection(capabilities: PromptCapabilities): string {
  const manual = registered(capabilities.tools, [
    INDEX_SEARCH_TOOL,
    WEB_SEARCH_TOOL,
    WEB_FETCH_TOOL,
    READ_NOTE_TOOL,
  ]);

  const lines = [
    `## Delegating a facet (${SUB_AGENT_TOOL})`,
    `${SUB_AGENT_TOOL} runs an independent sub-agent with your read-only tools (no mutation, no ` +
      "recursion) and returns a free-text answer already citing sources in your format.",
    '- Pass a focused `task` with its success criteria and any constraint ("web sources only"), ' +
      "name the resources it may consult, and keep its search budget tight.",
    "- Build your answer from the returned `answer`, reusing its citation tokens unchanged.",
  ];
  if (manual.length > 0) {
    lines.push(`- For a single lookup, call ${humanJoin(manual)} yourself instead.`);
  }
  return lines.join("\n");
}

/** Level five: comparing a set of documents on one issue with the mapping tool. */
export function buildMapSourcesSection(wanted: boolean): string {
  const heading = `## Comparing across documents (${MAP_SOURCES_TOOL})`;
  if (!wanted) {
    return [
      heading,
      `${MAP_SOURCES_TOOL} answers "where does each document stand on X" in one call. Reach for ` +
        "it when the question is naturally document × position; otherwise ignore it.",
    ].join("\n");
  }

  return [
    heading,
    `Where a *set* of documents stands on one issue — agreement, disagreement, coverage — is one ` +
      `${MAP_SOURCES_TOOL} call, not many manual searches. It returns a row per document.`,
    "- Omit `sourcePaths` to auto-select relevant documents; pass them when you already know " +
      "which to compare, and cap the fan-out with `maxSources`.",
    "- Render the rows as an evidence matrix: one row per document, its stance, and the finding " +
      "with its `[evidenceId]`. A row without a citation is unverifiable.",
    "- Group agreeing documents, call out those that oppose or do not address the question, and " +
      "report a row flagged with an `error` as unanalysed rather than as silence.",
  ].join("\n");
}

/** Level five: contradiction hunting through the claim index. */
export function buildFindClaimsSection(capabilities: PromptCapabilities, wanted: boolean): string {
  const heading = `## Finding contradictions across the corpus (${FIND_CLAIMS_TOOL})`;
  if (!wanted) {
    return [
      heading,
      `${FIND_CLAIMS_TOOL} groups claims on one subject across documents. Use it when the ` +
        "question is about disagreement between documents; otherwise ignore it.",
    ].join("\n");
  }

  const verify = capabilities.tools.has(READ_INDEX_CHUNK_TOOL)
    ? `- A contradiction requires two claims about the SAME subject that cannot both be true. ` +
      `Before asserting one, call ${READ_INDEX_CHUNK_TOOL} on both claims' \`chunkId\` to confirm ` +
      "the wording — the one-sentence claim is a pointer, not the evidence."
    : "- A contradiction requires two claims about the SAME subject that cannot both be true. " +
      "Confirm the wording of both before asserting one.";

  return [
    heading,
    `- Call ${FIND_CLAIMS_TOOL} with the subject. It returns claims grouped by subject across ` +
      "documents, each carrying a `chunkId`.",
    verify,
    "- Different wording of the same fact, a different scope, or different time and conditions is " +
      'NOT a contradiction. Say "no genuine contradiction" when that is the case.',
    "- Report each real conflict with the verified citation on both sides.",
  ].join("\n");
}

/** Level five: building a connected set of knowledge notes from the indexed corpus. */
export function buildCompileKnowledgeSection(capabilities: PromptCapabilities): string {
  const tools = capabilities.tools;
  const surveyTools = registered(tools, [
    GET_SOURCE_SUMMARY_TOOL,
    LIST_INDEX_SOURCES_TOOL,
    INDEX_SEARCH_TOOL,
  ]);
  const researchTools = registered(tools, [MAP_SOURCES_TOOL, INDEX_SEARCH_TOOL]);
  const dedupTools = registered(tools, [SEARCH_NOTES_TOOL, READ_NOTE_TOOL]);

  const survey =
    surveyTools.length > 0
      ? `Survey the corpus with ${humanJoin(surveyTools)} to map the topic into distinct entities ` +
        "or subtopics — one note each. Aim for a small connected set, not a single dump."
      : "Survey the corpus to map the topic into distinct entities or subtopics — one note each.";
  const research =
    researchTools.length > 0
      ? `Gather evidence for each planned note with ${humanJoin(researchTools)} before writing it` +
        (tools.has(MAP_SOURCES_TOOL)
          ? `; prefer ${MAP_SOURCES_TOOL} when the note spans several documents.`
          : ".")
      : "Gather evidence for each planned note before writing it.";
  const dedup =
    dedupTools.length > 0
      ? `Before ${CREATE_NOTE_TOOL}, check for an existing note on that entity with ` +
        `${humanJoin(dedupTools)}.`
      : `Before ${CREATE_NOTE_TOOL}, check whether a note on that entity already exists.`;

  return [
    "## Compiling corpus knowledge into notes",
    "The request asks for a connected set of knowledge notes, so build a graph, not a flat note:",
    `- ${survey}`,
    `- ${research} Every factual claim traces to an identifier from a tool result.`,
    `- ${dedup} If one exists, ${UPDATE_NOTE_TOOL} to APPEND a section — never overwrite. A re-run ` +
      "extends the existing notes instead of duplicating them.",
    "- Link related notes with `[[wikilinks]]` so the set forms a graph.",
  ].join("\n");
}

/** Level five: when a chart or gallery earns its place in the answer. */
export function buildRichMediaSection(capabilities: PromptCapabilities, wanted: boolean): string {
  const present = registered(capabilities.tools, [
    IMAGE_SEARCH_TOOL,
    PRESENT_IMAGE_GALLERY_TOOL,
    PRESENT_CHART_TOOL,
  ]);
  const heading = `## Showing visuals (${present.join(", ")})`;

  if (!wanted) {
    return [
      heading,
      "Use these only when the user asked for a visual or when one genuinely carries the answer. " +
        "Never use them to decorate.",
    ].join("\n");
  }

  const lines = [
    heading,
    "- Tables are ordinary Markdown with headers and no HTML; keep them narrow enough to read.",
    `- ${PRESENT_CHART_TOOL} takes chart DATA (bar, line, scatter, pie): at most ` +
      `${ARTIFACT_LIMITS.chartSeries} series and ${ARTIFACT_LIMITS.chartPointsPerSeries} points ` +
      "per series. SVG, HTML, CSS, scripts and image URLs are rejected.",
    "- Keep the citation for every visual in the surrounding prose or its caption.",
  ];
  if (capabilities.imageSearch) {
    lines.splice(
      1,
      0,
      `- Call ${IMAGE_SEARCH_TOOL} first and pass the returned \`imageId\` handles to ` +
        `${PRESENT_IMAGE_GALLERY_TOOL}; URLs are rejected. Query it with two or three concrete ` +
        "subject words, not the full question, and prefer English. On `no-image-candidates`, " +
        "retry once with fewer words before giving up.",
    );
  }
  return lines.join("\n");
}
