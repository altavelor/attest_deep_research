import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("chat composer source contract", () => {
  it("shows an Instant/Thinking selector beside the source selector", () => {
    const source = readFileSync(resolve("src/apps/obsidian/ui/chat/ChatComposer.ts"), "utf8");

    expect(source).toContain('{ id: "instant", name: t("chat.composer.researchMode.instant") }');
    expect(source).toContain('{ id: "thinking", name: t("chat.composer.researchMode.thinking") }');
    expect(source).toContain('ariaLabel: t("chat.composer.researchMode.aria")');
    expect(source.indexOf("sourcesModeDropdown")).toBeLessThan(
      source.indexOf("researchModeDropdown"),
    );
  });
});
