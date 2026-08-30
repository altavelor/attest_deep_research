import { describe, expect, it } from "vitest";
import { TFile } from "obsidian";

import { ObsidianGraphContextProvider } from "@adapters/obsidian/ObsidianGraphContextProvider";
import type { GraphContextRequest } from "@core/research";

const limits = {
  maxForwardLinksPerRoot: 3,
  maxEmbedsPerRoot: 3,
  maxBacklinksPerRoot: 3,
  maxGraphCandidatesTotal: 10,
};

function request(overrides: Partial<GraphContextRequest> = {}): GraphContextRequest {
  return {
    question: "",
    roots: [{ path: "Root.md", role: "question" }],
    availablePaths: ["Root.md", "Linked.md", "Embedded.md", "Backlink.md", "Nested.md"],
    includeBacklinks: true,
    maxDepth: 1,
    limits,
    ...overrides,
  };
}

function file(path: string): TFile {
  return Object.assign(new TFile(), { path, extension: path.slice(path.lastIndexOf(".") + 1) });
}

function graph(
  files: TFile[],
  options: {
    caches: Record<string, Record<string, unknown>>;
    backlinks?: Record<string, string[]>;
    content?: Record<string, string>;
  },
) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const vault = {
    getAbstractFileByPath: (path: string) => byPath.get(path) ?? null,
    cachedRead: async (file: TFile) => options.content?.[file.path] ?? "",
  };
  const metadataCache = {
    getFileCache: (file: TFile) => options.caches[file.path],
    getFirstLinkpathDest: () => null,
    getBacklinksForFile: (file: TFile) => ({
      data: Object.fromEntries((options.backlinks?.[file.path] ?? []).map((path) => [path, {}])),
    }),
  };
  return new ObsidianGraphContextProvider(vault as never, metadataCache as never);
}

describe("ObsidianGraphContextProvider", () => {
  it("merges metadata links, embeds, and backlinks in relevance order", async () => {
    const provider = graph(["Root.md", "Linked.md", "Embedded.md", "Backlink.md"].map(file), {
      caches: {
        "Root.md": { links: [{ link: "Linked" }], embeds: [{ link: "Embedded" }] },
      },
      backlinks: { "Root.md": ["Backlink.md"] },
    });

    const discovery = await provider.discover(request());

    expect(discovery.sourcePaths).toEqual(["Embedded.md", "Linked.md", "Backlink.md"]);
    expect(discovery.diagnostics).toMatchObject({ source: "metadataCache", unresolved: [] });
    expect(discovery.diagnostics.included[0]).toMatchObject({
      path: "Embedded.md",
      edges: [{ from: "Root.md", type: "embed", depth: 1 }],
    });
  });

  it("falls back to markdown parsing, follows a second depth, and reports unresolved links", async () => {
    const provider = graph(["Root.md", "Linked.md", "Embedded.md", "Nested.md"].map(file), {
      caches: {
        "Root.md": { links: [], embeds: [] },
        "Linked.md": { links: [], embeds: [] },
        "Embedded.md": { links: [], embeds: [] },
      },
      content: {
        "Root.md": "[[Linked]] ![[Embedded]] [[Missing]]",
        "Linked.md": "[[Nested]]",
      },
    });

    const discovery = await provider.discover(request({ includeBacklinks: false, maxDepth: 2 }));

    expect(discovery.sourcePaths).toEqual(["Embedded.md", "Linked.md", "Nested.md"]);
    expect(discovery.diagnostics).toMatchObject({
      source: "mixed",
      unresolved: [expect.objectContaining({ path: "Missing", reason: "unresolved-link" })],
    });
    expect(
      discovery.diagnostics.included.find((candidate) => candidate.path === "Nested.md"),
    ).toMatchObject({
      edges: [{ from: "Linked.md", type: "forward_link", depth: 2 }],
    });
  });

  it("uses a linked question alias as a graph root when no explicit root is supplied", async () => {
    const provider = graph(["Notes/Plan.md"].map(file), {
      caches: { "Notes/Plan.md": { frontmatter: { aliases: ["Project plan"] } } },
    });

    const discovery = await provider.discover(
      request({
        question: "Continue [[Project plan]]",
        roots: [],
        availablePaths: ["Notes/Plan.md"],
        includeBacklinks: false,
      }),
    );

    expect(discovery.diagnostics.rootPaths).toEqual(["Notes/Plan.md"]);
    expect(discovery.sourcePaths).toEqual([]);
  });

  it("ignores non-string frontmatter aliases while resolving valid aliases", async () => {
    const provider = graph(["Notes/Plan.md"].map(file), {
      caches: {
        "Notes/Plan.md": {
          frontmatter: { aliases: [null, 42, { name: "invalid" }, "Project plan"] },
        },
      },
    });

    const discovery = await provider.discover(
      request({
        question: "Continue [[Project plan]]",
        roots: [],
        availablePaths: ["Notes/Plan.md"],
        includeBacklinks: false,
      }),
    );

    expect(discovery.diagnostics.rootPaths).toEqual(["Notes/Plan.md"]);
  });

  it("records candidates dropped by the graph-size limit instead of expanding the context", async () => {
    const provider = graph(["Root.md", "First.md", "Second.md"].map(file), {
      caches: {
        "Root.md": { links: [{ link: "First" }, { link: "Second" }], embeds: [] },
      },
    });

    const discovery = await provider.discover(
      request({
        availablePaths: ["Root.md", "First.md", "Second.md"],
        includeBacklinks: false,
        limits: { ...limits, maxGraphCandidatesTotal: 1 },
      }),
    );

    expect(discovery.sourcePaths).toEqual(["First.md"]);
    expect(discovery.diagnostics.dropped).toEqual([
      expect.objectContaining({ path: "Second.md", reason: "graph_candidate_limit" }),
    ]);
  });
});
