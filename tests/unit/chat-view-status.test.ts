import { createTranslator } from "@adapters/i18n";
import {
  contextWindowStatus,
  searchUnavailableMessage,
} from "@apps/obsidian/ui/chat/chatViewStatus";

const t = createTranslator("en").t;

describe("chat view status", () => {
  it("reports the missing prerequisite for the selected search mode", () => {
    expect(
      searchUnavailableMessage(
        {
          chatModelProfileId: "model",
          searchMode: "webOnly",
          isWebSearchEnabled: false,
        },
        t,
      ),
    ).toBe("Enable web search in Attest settings to use this search mode.");
  });

  it("formats context-window warnings from token usage", () => {
    expect(contextWindowStatus(850, 1_000, t)).toMatchObject({
      usedPercent: 85,
      isWarning: true,
      ariaLabel: "Context window warning: 85% used, 15% left",
    });
  });
});
