import { readFileSync } from "node:fs";
import { createResearchToolRegistry } from "@adapters/research-tools";
import {
  assemblePromptSections,
  buildThinkingPromptSections,
  buildThinkingResearchMessages,
} from "@core/research";
import {
  INDEX_SEARCH_QUERY_CHARS,
  INDEX_SEARCH_RESULT_LIMIT,
  INDEX_URL_PAGE_LIMIT,
  PROMPT_TOOL_NAMES,
  URL_CHECK_BATCH_LIMIT,
  WEB_FETCH_TOOL,
} from "@core/agent";
import { ARTIFACT_LIMITS } from "@core/media";
import {
  MAX_WEB_FETCH_RESULT_IDS,
  MAX_WEB_QUERIES_PER_CALL,
  MAX_WEB_QUERY_CHARS,
  MAX_WEB_RESULT_LIMIT,
} from "@core/web";
import { ResearchRetriever } from "@application/contracts";
import { SearchProvider } from "@application/ports";
import { NoteToolService } from "@application/research";
import { ResearchSearchMode } from "@core/research";

const retriever: ResearchRetriever = {
  search: vi.fn().mockResolvedValue({ chunks: [], citations: [], usedFallback: false }),
  listIndexedUrls: vi.fn().mockResolvedValue({ items: [] }),
};

const provider: SearchProvider = {
  search: vi.fn().mockResolvedValue([]),
  fetchPage: vi.fn().mockResolvedValue({ ok: false }),
  fetchMetadata: vi.fn().mockResolvedValue({ ok: false }),
};
const urlStatusChecker = { checkUrls: vi.fn().mockResolvedValue([]) };
const subAgentRunner = { run: vi.fn() };

const noteTools: NoteToolService = {
  setCitationProvider: () => {},
  definitions: () => [],
  mutationEnabled: () => true,
  execute: vi.fn(),
};

interface Profile {
  name: string;
  searchMode: ResearchSearchMode;
}

const PROFILES: Profile[] = [
  { name: "index + web + deep + notes", searchMode: "indexAndWeb" },
  { name: "index only + notes", searchMode: "indexOnly" },
  { name: "web only + deep", searchMode: "webOnly" },
  { name: "vault (no evidence) + notes", searchMode: "none" },
];

/** Matches every intent so each profile assembles every module it can. */
const WIDEST_QUESTION =
  "Compile a knowledge base: compare the documents, find contradictions, " +
  "download the pdf and chart the numbers. Also open a URL and search my vault.";

function registryFor(searchMode: ResearchSearchMode) {
  return createResearchToolRegistry({
    retriever,
    searchProvider: provider,
    urlStatusChecker,
    subAgentRunner,
    noteTools,
    availability: {
      searchMode,
      noteAccess: true,
      activeFileAccess: true,
      noteMutationAccess: true,
      retrieverAvailable: true,
      webProviderAvailable: true,
    },
  });
}

function optionsFor(searchMode: ResearchSearchMode, available: string[]) {
  return {
    question: WIDEST_QUESTION,
    requiredTools: [],
    toolContext: {
      coreVariant: (searchMode === "none" ? "vault" : "research") as "vault" | "research",
      availableTools: available,
      indexDescription: "Some indexed material",
      parallelToolCalls: true,
    },
  };
}

function promptFor(searchMode: ResearchSearchMode): { text: string; available: string[] } {
  const created = registryFor(searchMode);
  const available = created.tools.definitions().map((d) => d.function.name);
  const messages = buildThinkingResearchMessages(optionsFor(searchMode, available));
  const text = messages.map((m) => m.content).join("\n");
  return { text: stripAvailabilityRule(text), available };
}

function stripAvailabilityRule(text: string): string {
  return text.replace(/## Source availability \(hard limit\)[\s\S]*?(?=\n\n|$)/, "");
}

describe("thinking prompt ↔ tool registry drift guard", () => {
  it.each(PROFILES)(
    "advertises no tool that the runtime did not register ($name)",
    ({ searchMode }) => {
      const { text, available } = promptFor(searchMode);
      const registered = new Set(available);
      for (const name of PROMPT_TOOL_NAMES) {
        const mentioned = new RegExp(`\\b${name}\\b`).test(text);
        if (mentioned) {
          expect(
            registered.has(name),
            `prompt mentions "${name}" but it is not registered for searchMode=${searchMode}`,
          ).toBe(true);
        }
      }
    },
  );

  it.each(PROFILES)(
    "declares only referencedTools the runtime registered ($name)",
    ({ searchMode }) => {
      const created = registryFor(searchMode);
      const available = new Set(created.tools.definitions().map((d) => d.function.name));
      const sections = buildThinkingPromptSections(optionsFor(searchMode, [...available]));
      for (const section of sections.filter((entry) => entry.enabled)) {
        for (const tool of section.referencedTools) {
          expect(
            available.has(tool),
            `section "${section.id}" references "${tool}", not registered for ${searchMode}`,
          ).toBe(true);
        }
      }
    },
  );

  it("reports a section that names a tool the profile does not register", () => {
    const { available } = promptFor("indexOnly");
    const sections = buildThinkingPromptSections(optionsFor("indexOnly", available));
    const result = assemblePromptSections(
      [
        ...sections,
        {
          id: "invented",
          priority: "workflow" as const,
          enabled: true,
          content: "## Invented\nuse ghost_tool",
          referencedTools: ["ghost_tool"],
        },
      ],
      { availableTools: new Set(available) },
    );
    expect(result.issues).toContainEqual({
      sectionId: "invented",
      code: "unregistered-tool",
      detail: "ghost_tool",
      dropped: false,
    });
  });

  it("does not advertise web fetch in an index-only profile (the original regression)", () => {
    const { text, available } = promptFor("indexOnly");
    expect(available).not.toContain(WEB_FETCH_TOOL);
    expect(new RegExp(`\\b${WEB_FETCH_TOOL}\\b`).test(text)).toBe(false);
  });
});

describe("numeric limit drift guard", () => {
  const allowed = new Set(
    [
      INDEX_SEARCH_QUERY_CHARS,
      INDEX_SEARCH_RESULT_LIMIT,
      INDEX_URL_PAGE_LIMIT,
      URL_CHECK_BATCH_LIMIT,
      MAX_WEB_QUERY_CHARS,
      MAX_WEB_QUERIES_PER_CALL,
      MAX_WEB_RESULT_LIMIT,
      MAX_WEB_FETCH_RESULT_IDS,
      ARTIFACT_LIMITS.chartSeries,
      ARTIFACT_LIMITS.chartPointsPerSeries,
    ].map(String),
  );

  function unexpectedNumerals(system: string): string[] {
    const withoutDate = system.replace(/^Current date:.*$/m, "");
    const numerals = [...withoutDate.matchAll(/\d+/g)].map((match) => match[0]);
    return [...new Set(numerals)].filter((value) => !allowed.has(value));
  }

  it.each(PROFILES)("writes no number that is not a schema constant ($name)", ({ searchMode }) => {
    const created = registryFor(searchMode);
    const available = created.tools.definitions().map((d) => d.function.name);
    const system = buildThinkingResearchMessages(optionsFor(searchMode, available))[0].content;
    expect(
      unexpectedNumerals(system),
      `unexpected numeric literals in the ${searchMode} prompt`,
    ).toEqual([]);
  });

  it("catches a literal that drifted away from its schema constant", () => {
    const created = registryFor("webOnly");
    const available = created.tools.definitions().map((d) => d.function.name);
    const system = buildThinkingResearchMessages(optionsFor("webOnly", available))[0].content;
    const drifted = system.replace(
      `\`limit\` returns up to ${MAX_WEB_RESULT_LIMIT} results`,
      "`limit` returns up to 7 results",
    );
    expect(drifted).not.toBe(system);
    expect(unexpectedNumerals(drifted)).toEqual(["7"]);
    expect(unexpectedNumerals(system)).toEqual([]);
  });
});

describe("parallel capability plumbing", () => {
  const sources = {
    ThinkingResearchStrategy: readFileSync(
      "src/application/use-cases/research/strategies/ThinkingResearchStrategy.ts",
      "utf8",
    ),
    SubAgentRunner: readFileSync(
      "src/application/use-cases/research/sub-agent/SubAgentRunner.ts",
      "utf8",
    ),
  };

  it("passes parallelToolCalls from the research strategy policy", () => {
    expect(sources.ThinkingResearchStrategy).toContain(
      "parallelToolCalls: effectivePolicy.parallelToolCalls",
    );
  });

  it("passes parallelToolCalls from the sub-agent policy", () => {
    expect(sources.SubAgentRunner).toContain(
      "parallelToolCalls: SUB_AGENT_POLICY.parallelToolCalls",
    );
  });

  it("routes prompt assembly issues into the run diagnostics", () => {
    expect(sources.ThinkingResearchStrategy).toContain("onAssemblyIssue:");
    expect(sources.ThinkingResearchStrategy).toContain("promptAssemblyIssues");
    expect(sources.ThinkingResearchStrategy).toContain("diagnostics.warnings.push(warning)");
  });

  it("forwards every assembly issue from the builder to its hook", () => {
    const builder = readFileSync("src/core/research/thinkingPrompts.ts", "utf8");
    expect(builder).toContain("for (const issue of assembled.issues)");
    expect(builder).toContain("options.onAssemblyIssue?.(issue)");
  });

  it("keeps the field optional so existing callers still compile", () => {
    const messages = buildThinkingResearchMessages({
      question: "Q",
      requiredTools: [],
      toolContext: { coreVariant: "research", availableTools: [] },
    });
    expect(messages[0].content).toContain("Issue one tool call at a time");
  });
});
