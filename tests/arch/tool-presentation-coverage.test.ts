import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

import { humanizeToolName, TOOL_PRESENTATIONS, toolIntent, toolTitle } from "@core/agent";

/**
 * Canonical tool names read from the source of truth. Scanning the file instead
 * of importing a hand-kept array means a new constant cannot be added without
 * this guard noticing it.
 */
function declaredToolNames(): string[] {
  const source = readFileSync(resolve("src/core/agent/toolNames.ts"), "utf8");
  return [...source.matchAll(/export const \w+_TOOL = "([^"]+)";/g)].map((match) => match[1]!);
}

describe("tool presentation coverage", () => {
  const tools = declaredToolNames();

  it("finds the canonical tool list", () => {
    expect(tools.length).toBeGreaterThan(20);
  });

  it("gives every registered tool a title and an intent", () => {
    const missing = tools.filter((name) => TOOL_PRESENTATIONS[name] === undefined);
    expect(missing).toEqual([]);
  });

  it("never shows a raw snake_case name to the user", () => {
    for (const name of tools) {
      const title = toolTitle(name);
      const intent = toolIntent(name, { args: {} });
      expect(title, name).not.toContain("_");
      expect(intent, name).toBeDefined();
      expect(intent!, name).not.toContain("_");
      expect(intent!.length, name).toBeGreaterThan(0);
    }
  });

  it("describes a call both with and without arguments", () => {
    const args = {
      query: "solar system",
      path: "Notes/Topic.md",
      sourcePath: "docs/report.pdf",
      url: "https://example.com/a",
      urls: ["https://example.com/a"],
      resultIds: ["r1", "r2"],
      imageIds: ["img_1"],
      task: "check the numbers",
      question: "what changed?",
      title: "Revenue",
      chartType: "bar",
      content: "body",
      prefix: "Notes",
      heading: "Intro",
      author: "Ivanov",
      limit: 5,
    };
    for (const name of tools) {
      expect(toolIntent(name, { args })!.length, name).toBeGreaterThan(0);
      expect(toolIntent(name, { args: {} })!.length, name).toBeGreaterThan(0);
    }
  });

  it("keeps every title short enough for the workflow head", () => {
    for (const name of tools) {
      expect(toolTitle(name).length, name).toBeLessThanOrEqual(24);
    }
  });
});

describe("humanized fallback", () => {
  it.each([
    ["search_images", "Search images"],
    ["present_chart", "Present chart"],
    ["some-future-tool", "Some future tool"],
  ])("renders %s as %s", (name, expected) => {
    expect(humanizeToolName(name)).toBe(expected);
  });

  it("titles an unregistered tool without touching the catalog", () => {
    expect(toolTitle("brand_new_tool")).toBe("Brand new tool");
    expect(toolIntent("brand_new_tool", { args: {} })).toBeUndefined();
  });
});
