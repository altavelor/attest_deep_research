import { describe, expect, it } from "vitest";

import { SkillDefinition } from "../../src/skills/SkillRegistry";
import { SkillSelectionService } from "../../src/skills/SkillSelectionService";
import { FakeChatModel } from "../helpers/researchFakes";

const skills: SkillDefinition[] = [
  {
    id: "note-synthesis",
    name: "Note Synthesis",
    description: "Synthesize notes.",
    path: ".ixplorer/skills/note-synthesis/SKILL.md",
    aliases: [],
  },
  {
    id: "rag-debugger",
    name: "RAG Debugger",
    description: "Debug retrieval.",
    path: ".ixplorer/skills/rag-debugger/SKILL.md",
    aliases: [],
  },
];

describe("SkillSelectionService", () => {
  it("selects one exact catalog id through a compact model request", async () => {
    const chatModel = new FakeChatModel([
      { content: '{"skill":"note-synthesis"}', isComplete: false },
      { content: "", isComplete: true },
    ]);
    const selector = new SkillSelectionService({
      chatModel,
      model: "qwen",
      maxTokens: 80,
    });

    const result = await selector.select("Summarize these notes", skills);

    expect(result).toEqual({ skill: skills[0] });
    expect(chatModel.requests).toHaveLength(1);
    expect(chatModel.requests[0]).toMatchObject({ temperature: 0, maxTokens: 80 });
    expect(chatModel.requests[0].messages[0].content).toContain("Return JSON only");
    expect(chatModel.requests[0].messages[1].content).toContain("note-synthesis");
    expect(chatModel.requests[0].messages[1].content).not.toContain("vault evidence");
  });

  it("returns none with a warning for invalid or unknown selector output", async () => {
    const chatModel = new FakeChatModel([
      { content: '{"skill":"unknown"}', isComplete: false },
      { content: "", isComplete: true },
    ]);
    const selector = new SkillSelectionService({ chatModel, model: "qwen" });

    await expect(selector.select("Question", skills)).resolves.toEqual({
      warning: "unknown-skill-selection",
    });
  });

  it("does not call the model when the catalog is empty", async () => {
    const chatModel = new FakeChatModel();
    const selector = new SkillSelectionService({ chatModel, model: "qwen" });

    await expect(selector.select("Question", [])).resolves.toEqual({});
    expect(chatModel.requests).toHaveLength(0);
  });
});
