import { describe, expect, it } from "vitest";

import {
  SkillFileStore,
  SkillRegistry,
  buildSkillCatalogPrompt,
  resolveExplicitSkill,
} from "../../src/skills/SkillRegistry";
import { DEFAULT_SKILLS } from "../../src/skills/defaultSkills";

class MemorySkillStore implements SkillFileStore {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = `${path.replace(/\/$/, "")}/`;
    const files = [...this.files.keys()].filter((candidate) => {
      const rest = candidate.startsWith(prefix) ? candidate.slice(prefix.length) : "";
      return rest.length > 0 && !rest.includes("/");
    });
    const folders = [...this.folders].filter((candidate) => {
      const rest = candidate.startsWith(prefix) ? candidate.slice(prefix.length) : "";
      return rest.length > 0 && !rest.includes("/");
    });
    return { files, folders };
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) {
      throw new Error(`Missing file: ${path}`);
    }
    return value;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async mkdir(path: string): Promise<void> {
    const parts = path.split("/");
    for (let index = 1; index <= parts.length; index += 1) {
      this.folders.add(parts.slice(0, index).join("/"));
    }
  }
}

function skillFile(name: string, description: string, body = "# Workflow\nUse evidence."): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "aliases:",
    "  - review",
    "version: 1",
    "---",
    "",
    body,
  ].join("\n");
}

describe("SkillRegistry", () => {
  it("ships the ten specified default skills with valid metadata", async () => {
    const expectedIds = [
      "citation-grounded-answer",
      "contradiction-finder",
      "literature-review",
      "meeting-notes",
      "note-synthesis",
      "project-memory",
      "prompt-template-builder",
      "rag-debugger",
      "vault-context-assembly",
      "zettelkasten-linker",
    ];
    const store = new MemorySkillStore();
    const registry = new SkillRegistry({ store, defaults: DEFAULT_SKILLS });

    const snapshot = await registry.initialize();

    expect(snapshot.skills.map((skill) => skill.id)).toEqual(expectedIds);
    expect(snapshot.warnings).toEqual([]);
    expect(snapshot.skills.find((skill) => skill.id === "literature-review")?.aliases).toContain(
      "research-review",
    );
  });

  it("ships enforceable output contracts for the three foundational skills", () => {
    const content = (id: string) => DEFAULT_SKILLS.find((skill) => skill.id === id)?.content ?? "";

    expect(content("vault-context-assembly")).toContain("Explicitly attached or named files.");
    expect(content("vault-context-assembly")).toContain("Retrieved RAG chunks.");
    expect(content("citation-grounded-answer")).toContain("### Used sources");
    expect(content("citation-grounded-answer")).toContain("### Missing evidence");
    expect(content("citation-grounded-answer")).toContain("### Ambiguities");
    expect(content("rag-debugger")).toContain("**Ranked chunks**");
    expect(content("rag-debugger")).toContain("path, chunk ID, rank, and score");
  });

  it("discovers only one-level SKILL.md files and builds a body-free catalog", async () => {
    const store = new MemorySkillStore();
    await store.mkdir(".ixplorer/skills/note-synthesis");
    await store.mkdir(".ixplorer/skills/nested/ignored");
    await store.write(
      ".ixplorer/skills/note-synthesis/SKILL.md",
      skillFile("Note Synthesis", "Synthesize selected notes.", "SECRET BODY"),
    );
    await store.write(
      ".ixplorer/skills/nested/ignored/SKILL.md",
      skillFile("Ignored", "Nested skill."),
    );

    const registry = new SkillRegistry({ store, defaults: [] });
    const snapshot = await registry.refresh();
    const prompt = buildSkillCatalogPrompt(snapshot.skills);

    expect(snapshot.skills).toEqual([
      expect.objectContaining({
        id: "note-synthesis",
        name: "Note Synthesis",
        description: "Synthesize selected notes.",
        path: ".ixplorer/skills/note-synthesis/SKILL.md",
        aliases: ["review"],
      }),
    ]);
    expect(prompt).toContain("Note Synthesis");
    expect(prompt).toContain(".ixplorer/skills/note-synthesis/SKILL.md");
    expect(prompt).not.toContain("SECRET BODY");
  });

  it("omits invalid and colliding skills with diagnostic warnings", async () => {
    const store = new MemorySkillStore();
    for (const id of ["one", "two", "missing-description"]) {
      await store.mkdir(`.ixplorer/skills/${id}`);
    }
    await store.write(".ixplorer/skills/one/SKILL.md", skillFile("Duplicate", "First."));
    await store.write(".ixplorer/skills/two/SKILL.md", skillFile("duplicate", "Second."));
    await store.write(
      ".ixplorer/skills/missing-description/SKILL.md",
      "---\nname: Invalid\n---\nBody",
    );

    const snapshot = await new SkillRegistry({ store, defaults: [] }).refresh();

    expect(snapshot.skills).toEqual([]);
    expect(snapshot.warnings.map((warning) => warning.reason)).toEqual(
      expect.arrayContaining(["duplicate-name", "missing-description"]),
    );
  });

  it("refreshes cached metadata after a vault event marks the catalog dirty", async () => {
    const store = new MemorySkillStore();
    const path = ".ixplorer/skills/note-synthesis/SKILL.md";
    await store.mkdir(".ixplorer/skills/note-synthesis");
    await store.write(path, skillFile("Old Name", "Old description."));
    const registry = new SkillRegistry({ store, defaults: [] });
    await registry.refresh();

    await store.write(path, skillFile("New Name", "New description."));
    expect((await registry.getSnapshot()).skills[0].name).toBe("Old Name");
    registry.markDirty();

    expect((await registry.getSnapshot()).skills[0]).toMatchObject({
      name: "New Name",
      description: "New description.",
    });
  });

  it("installs defaults once, preserves edits, and does not restore deleted defaults", async () => {
    const store = new MemorySkillStore();
    const defaults = [
      { id: "alpha", content: skillFile("Alpha", "Alpha workflow.") },
      { id: "beta", content: skillFile("Beta", "Beta workflow.") },
    ];
    const registry = new SkillRegistry({ store, defaults });

    await registry.initialize();
    await store.write(".ixplorer/skills/alpha/SKILL.md", "user edit");
    store.files.delete(".ixplorer/skills/beta/SKILL.md");
    await registry.initialize();

    expect(await store.read(".ixplorer/skills/alpha/SKILL.md")).toBe("user edit");
    expect(await store.exists(".ixplorer/skills/beta/SKILL.md")).toBe(false);
  });

  it("resolves exact id or alias mentions and rejects multiple skills", async () => {
    const store = new MemorySkillStore();
    for (const id of ["note-synthesis", "rag-debugger"]) {
      await store.mkdir(`.ixplorer/skills/${id}`);
    }
    await store.write(
      ".ixplorer/skills/note-synthesis/SKILL.md",
      skillFile("Note Synthesis", "Synthesize notes."),
    );
    await store.write(
      ".ixplorer/skills/rag-debugger/SKILL.md",
      skillFile("RAG Debugger", "Debug retrieval.").replace("  - review", "  - debug-rag"),
    );
    const { skills } = await new SkillRegistry({ store, defaults: [] }).refresh();

    expect(resolveExplicitSkill("@review summarize this", skills)).toEqual(
      expect.objectContaining({
        kind: "selected",
        normalizedQuestion: "summarize this",
        skill: expect.objectContaining({ id: "note-synthesis" }),
      }),
    );
    expect(resolveExplicitSkill("@note-synthesis @rag-debugger inspect", skills)).toEqual(
      expect.objectContaining({ kind: "error", reason: "multiple-skills" }),
    );
    expect(resolveExplicitSkill("@missing-skill inspect", skills)).toEqual(
      expect.objectContaining({ kind: "error", reason: "unknown-skill" }),
    );
  });

  it("loads the complete selected skill without the normal read_note character limit", async () => {
    const store = new MemorySkillStore();
    const body = "x".repeat(20_000);
    await store.mkdir(".ixplorer/skills/large");
    await store.write(
      ".ixplorer/skills/large/SKILL.md",
      skillFile("Large", "Large workflow.", body),
    );
    const registry = new SkillRegistry({ store, defaults: [] });
    const { skills } = await registry.refresh();

    const loaded = await registry.load(skills[0], { maxTokens: 10_000 });

    expect(loaded.content).toContain(body);
    expect(loaded.characters).toBeGreaterThan(20_000);
    expect(loaded.truncated).toBe(false);
  });

  it("returns skill-too-large instead of truncating", async () => {
    const store = new MemorySkillStore();
    await store.mkdir(".ixplorer/skills/large");
    await store.write(
      ".ixplorer/skills/large/SKILL.md",
      skillFile("Large", "Large workflow.", "x".repeat(20_000)),
    );
    const registry = new SkillRegistry({ store, defaults: [] });
    const { skills } = await registry.refresh();

    await expect(registry.load(skills[0], { maxTokens: 100 })).rejects.toMatchObject({
      code: "skill-too-large",
    });
  });
});
