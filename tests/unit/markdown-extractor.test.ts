import { readFileSync } from "fs";
import { join } from "path";

import { MarkdownExtractor } from "@adapters/extractors";
import { chunkMarkdown } from "@adapters/indexing";

const fixturePath = join(__dirname, "../fixtures/markdown/research-note.md");

describe("MarkdownExtractor", () => {
  it("splits markdown into chunks with heading trails and frontmatter removed", async () => {
    const extractor = new MarkdownExtractor({ maxChunkLength: 120 });
    const chunks = await extractor.extract({
      path: "Research/research-note.md",
      data: readFileSync(fixturePath, "utf8"),
      modifiedTime: 1,
    });

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({
      source: {
        kind: "markdown",
        path: "Research/research-note.md",
        title: "Project Alpha",
        headingPath: ["Project Alpha"],
        blockId: "intro-block",
      },
      text: "Opening context for the project. ^intro-block",
    });
    expect(chunks[1].source).toMatchObject({
      headingPath: ["Project Alpha", "Findings"],
      title: "Findings",
    });
    expect(chunks[1].text).toContain("First finding");
    expect(chunks[1].text).not.toContain("title: Research Note");
    expect(chunks[2].source).toMatchObject({
      headingPath: ["Project Alpha", "Findings", "Caveats"],
      title: "Caveats",
    });
  });

  it("honors selected folders and exclude globs", async () => {
    const extractor = new MarkdownExtractor({
      includeFolders: ["Research"],
      excludeGlobs: ["Research/Archive/**", "**/*.draft.md"],
    });

    expect(extractor.shouldExtractPath("Research/Notes/topic.md")).toBe(true);
    expect(extractor.shouldExtractPath("Research/Archive/old.md")).toBe(false);
    expect(extractor.shouldExtractPath("Research/Notes/topic.draft.md")).toBe(false);
    expect(extractor.shouldExtractPath("Journal/today.md")).toBe(false);
    expect(extractor.supports("Research/Notes/topic.md")).toBe(true);
    expect(extractor.supports("Research/Notes/topic.txt")).toBe(false);
  });

  it("keeps chunk ids stable when unrelated files change", () => {
    const first = chunkMarkdown({
      path: "Research/research-note.md",
      text: "# Stable\n\nSame content.",
      maxChunkLength: 200,
    });
    const second = chunkMarkdown({
      path: "Research/research-note.md",
      text: "# Stable\n\nSame content.",
      maxChunkLength: 200,
    });
    const unrelated = chunkMarkdown({
      path: "Research/other.md",
      text: "# Stable\n\nSame content.",
      maxChunkLength: 200,
    });

    expect(second.map((chunk) => chunk.id)).toEqual(first.map((chunk) => chunk.id));
    expect(unrelated.map((chunk) => chunk.id)).not.toEqual(first.map((chunk) => chunk.id));
  });

  it("splits large notes into bounded chunks", () => {
    const chunks = chunkMarkdown({
      path: "Research/large.md",
      text: `# Large\n\n${Array.from({ length: 12 }, (_, index) => `Paragraph ${index} ${"x".repeat(40)}`).join("\n\n")}`,
      maxChunkLength: 140,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.text.length <= 140)).toBe(true);
    expect(
      chunks.every(
        (chunk) =>
          chunk.source.kind === "markdown" && chunk.source.headingPath.join("/") === "Large",
      ),
    ).toBe(true);
  });

  it("can overlap adjacent chunks to preserve boundary context", () => {
    const chunks = chunkMarkdown({
      path: "Research/overlap.md",
      text: `# Overlap\n\n${["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"].join(" ")}`,
      maxChunkLength: 22,
      chunkOverlap: 8,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1].text).toContain("charlie");
  });
});
