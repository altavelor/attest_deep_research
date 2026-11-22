import { describe, expect, it } from "vitest";

import { ResearchExportService } from "@application/use-cases/research/deep-research";
import {
  createConversationSourceRegistry,
  registerConversationEvidence,
} from "@core/chat/sourceRegistry";
import { serializeResearchExport } from "@core/research/deepResearch";
import { finishedReport, MemoryResearchNotes } from "../support/deepResearch";
import { markdownSource, retrieved, webSource } from "../support/factories";

function exporter(notes: MemoryResearchNotes, title: string) {
  return new ResearchExportService({
    writer: notes,
    defaultFolder: () => "Attest/Research/",
    now: () => new Date(2026, 2, 4, 23, 30),
    context: {
      chatId: "chat-1",
      researchId: "research-1",
      title,
      registry: createConversationSourceRegistry(),
    },
  });
}

describe("research export", () => {
  it("never replaces a note, numbers taken names and keeps exports inside the vault", async () => {
    const notes = new MemoryResearchNotes();
    notes.files.set("Attest/Research/Tides - 2026-03-04.md", "mine");
    notes.raced.add("Attest/Research/Tides - 2026-03-04 (2).md");
    const service = exporter(notes, "../.Tides/\n");

    await expect(service.export(finishedReport("Body"))).resolves.toEqual({
      path: "Attest/Research/Tides - 2026-03-04 (3).md",
    });
    expect(notes.files.get("Attest/Research/Tides - 2026-03-04.md")).toBe("mine");
    expect(notes.files.get("Attest/Research/Tides - 2026-03-04 (2).md")).toBe("other writer");
    for (const folder of [
      "../Outside",
      "Notes//Deep",
      "C:/Notes",
      "Notes\\Deep",
      ".attest/chats",
      "a/ .. /b",
      ".attest /x",
      ".obsidian/x",
      "x./y",
    ]) {
      await expect(service.export(finishedReport("Body"), folder)).rejects.toMatchObject({
        details: { reason: "research-export-folder" },
      });
    }
    await expect(service.export(finishedReport("Body"), ".Attest/x")).rejects.toThrow(
      "The export folder leaves the vault or enters a hidden folder: .Attest/x",
    );
  });

  it("writes escaped front matter and links only registry citations by their kind", () => {
    const registered = registerConversationEvidence(
      createConversationSourceRegistry(),
      [
        retrieved("note-chunk", { ...markdownSource("Notes/tides.md"), title: "Tides|]] x" }, "a"),
        retrieved(
          "web-chunk",
          { ...webSource("https://example.org/a b(c)"), title: "Site ](x)" },
          "b",
        ),
        retrieved("bad-chunk", { ...webSource("javascript:alert(1)"), title: "Bad" }, "c"),
      ],
      "2026-03-04T00:00:00.000Z",
    );
    const id = (chunk: string) => registered.revisionIdByEvidenceId.get(chunk)!;
    const sources = new Map(
      ["note-chunk", "web-chunk", "bad-chunk"].map((chunk) => [
        id(chunk),
        registered.registry.sources
          .flatMap((source) => source.revisions)
          .find((revision) => revision.id === id(chunk))!.chunks[0]!.source,
      ]),
    );
    const text = serializeResearchExport({
      report: finishedReport(
        `A [${id("note-chunk")}] B [${id("web-chunk")}] C [${id("bad-chunk")}] D [unknown-token-1]`,
      ),
      chatId: 'chat"\n---\nevil: 1',
      researchId: "research-1",
      sources,
    });

    expect(text.split("\n").slice(0, 8)).toEqual([
      "---",
      'type: "attest-research-report"',
      'chat_id: "chat\\" --- evil: 1"',
      'research_id: "research-1"',
      'created: "2026-03-04T05:06:07.000Z"',
      'quality: "partial"',
      "---",
      "",
    ]);
    expect(text).toContain("A [[Notes/tides.md|Tides x]] B");
    expect(text).toContain("B [Site \\](x)](https://example.org/a%20b%28c%29) C");
    expect(text).toContain("C Bad D [unknown-token-1]");
  });
});
