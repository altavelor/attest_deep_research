import {
  contextWindowStatus,
  searchUnavailableMessage,
} from "@apps/obsidian/ui/chat/chatViewStatus";

describe("chat view status", () => {
  it("reports the missing prerequisite for the selected search mode", () => {
    expect(
      searchUnavailableMessage({
        chatModelProfileId: "model",
        searchMode: "webOnly",
        isWebSearchEnabled: false,
      }),
    ).toBe("Enable web search in Ixplorer settings to use this search mode.");
  });

  it("formats context-window warnings from token usage", () => {
    expect(contextWindowStatus(850, 1_000)).toMatchObject({
      usedPercent: 85,
      isWarning: true,
      ariaLabel: "Context window warning: 85% used, 15% left",
    });
  });
});
