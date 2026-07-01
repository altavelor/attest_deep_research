import { describe, expect, it } from "vitest";

import {
  parseMarkdownGraphLinks,
  resolveMarkdownLinkTarget,
} from "@core/research";

describe("GraphContext markdown fallback", () => {
  it("parses wiki links, embeds, heading links, and markdown links", () => {
    const parsed = parseMarkdownGraphLinks([
      "---",
      "aliases: [IgnoredLink]",
      "---",
      "# Root",
      "[[Project|Project alias]]",
      "[[Spec#Requirements]]",
      "![[Brief.md]]",
      "[meeting](Meetings/Kickoff.md)",
      "`[[Ignored inline]]`",
      "```",
      "[[Ignored code]]",
      "```",
      "<!-- [[Ignored comment]] -->",
    ].join("\n"));

    expect(parsed.links).toEqual(["Project", "Spec#Requirements", "Meetings/Kickoff.md"]);
    expect(parsed.embeds).toEqual(["Brief.md"]);
  });

  it("resolves exact paths, relative paths, unique basenames, and unique aliases", () => {
    const paths = [
      "Projects/Project.md",
      "Projects/Meetings/Kickoff.md",
      "Archive/Duplicate.md",
      "Other/Duplicate.md",
    ];
    const aliases = new Map<string, string[]>([
      ["alpha", ["Projects/Project.md"]],
      ["roadmap", ["Archive/Duplicate.md", "Other/Duplicate.md"]],
    ]);

    expect(resolveMarkdownLinkTarget("Projects/Project.md", "Root.md", paths)).toBe(
      "Projects/Project.md",
    );
    expect(resolveMarkdownLinkTarget("Meetings/Kickoff.md", "Projects/Root.md", paths)).toBe(
      "Projects/Meetings/Kickoff.md",
    );
    expect(resolveMarkdownLinkTarget("Project", "Root.md", paths)).toBe("Projects/Project.md");
    expect(resolveMarkdownLinkTarget("Alpha", "Root.md", paths, aliases)).toBe(
      "Projects/Project.md",
    );
    expect(resolveMarkdownLinkTarget("Duplicate", "Root.md", paths, aliases)).toBeUndefined();
    expect(resolveMarkdownLinkTarget("Roadmap", "Root.md", paths, aliases)).toBeUndefined();
  });
});
