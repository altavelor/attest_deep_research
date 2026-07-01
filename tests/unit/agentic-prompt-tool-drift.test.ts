import { createResearchToolRegistry } from "@adapters/research-tools";
import { buildAgenticResearchMessages } from "@core/research";
import { PROMPT_TOOL_NAMES, WEB_FETCH_TOOL } from "@core/agent";
import { ResearchRetriever } from "../../src/application/contracts/research";
import { SearchProvider } from "../../src/application/ports/web";
import { NoteToolService } from "../../src/application/research/toolPorts";
import { ResearchSearchMode } from "@core/research";

const retriever: ResearchRetriever = {
  search: vi.fn().mockResolvedValue({ chunks: [], citations: [], usedFallback: false }),
  listIndexedUrls: vi.fn().mockResolvedValue({ items: [] }),
};
// Mirrors the real web composition: when web is enabled the provider can both
// search and fetch pages, so search_web and fetch_web_page register together.
const provider: SearchProvider = {
  search: vi.fn().mockResolvedValue([]),
  fetchPage: vi.fn().mockResolvedValue({ ok: false }),
  fetchMetadata: vi.fn().mockResolvedValue({ ok: false }),
};
const urlStatusChecker = { checkUrls: vi.fn().mockResolvedValue([]) };
const deepResearchRunner = { run: vi.fn() };
// Minimal service: the registry only needs setCitationProvider + the tool declarations.
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

function registryFor(searchMode: ResearchSearchMode) {
  return createResearchToolRegistry({
    retriever,
    searchProvider: provider,
    urlStatusChecker,
    deepResearchRunner,
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

function promptFor(searchMode: ResearchSearchMode): { text: string; available: string[] } {
  const created = registryFor(searchMode);
  const available = created.tools.definitions().map((d) => d.function.name);
  const messages = buildAgenticResearchMessages({
    question: "Open a URL and also search my vault",
    requiredTools: [],
    toolContext: {
      coreVariant: searchMode === "none" ? "vault" : "research",
      availableTools: available,
      indexDescription: "Some indexed material",
    },
  });
  const text = messages.map((m) => m.content).join("\n");
  return { text: stripAvailabilityRule(text), available };
}

// The "Source availability" block is a deny-list: it deliberately names OFF tools to
// tell the model it must NOT use them. It is the opposite of advertising, so the drift
// scan excludes it — otherwise it would flag its own "you have no search_web" line.
function stripAvailabilityRule(text: string): string {
  return text.replace(/## Source availability \(hard limit\)[\s\S]*?(?=\n\n|$)/, "");
}

describe("agentic prompt ↔ tool registry drift guard", () => {
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

  it("does not advertise web fetch in an index-only profile (the original regression)", () => {
    const { text, available } = promptFor("indexOnly");
    expect(available).not.toContain(WEB_FETCH_TOOL);
    expect(new RegExp(`\\b${WEB_FETCH_TOOL}\\b`).test(text)).toBe(false);
  });
});
