// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTranslator } from "@adapters/i18n";
import { renderSubAgentTimelineItem } from "@apps/obsidian/ui/chat/subAgentEvents";
import { dispatchEvent } from "@core/chat/subAgentPlacement";
import type { NormalizedUsage, SubAgentNoticeEntry } from "@core/research";
import { installObsidianDomHelpers, resetDom } from "../../support/domHarness";

const t = createTranslator("en").t;
const TOKEN = "subagent:import-55e40e:1";
const usage: NormalizedUsage = {
  requestCount: 2,
  modelRounds: 2,
  toolCalls: 7,
  durationMs: 12_000,
  totalTokens: 15_400,
  source: "provider",
};

function finished(extra: Partial<SubAgentNoticeEntry> = {}): SubAgentNoticeEntry {
  return {
    eventKey: "notice:finished",
    parentRunId: "p1",
    description: "Find primary sources",
    createdAt: "t",
    sessionId: "s1",
    runId: "r1",
    sequence: 5,
    kind: "finished",
    ...extra,
  };
}

function render(notice: SubAgentNoticeEntry): HTMLElement {
  const host = document.createElement("div");
  renderSubAgentTimelineItem(
    host,
    { kind: "agent-notice", sequence: 5, notice },
    {
      t,
      onOpenSubAgentSession: () => {},
    },
  );
  return host;
}

describe("sub-agent event cards", () => {
  beforeEach(() => installObsidianDomHelpers());
  afterEach(() => resetDom());

  it("renders the reply as inert safe markup folded at a safe boundary", () => {
    const reply = [
      "## Findings",
      `**Found** the *date* in \`S-1\` [${TOKEN}] [docs](https://x.test) ![i](https://x.test/i.png) <img src=x onerror=alert(1)>`,
      "- first",
      "- second",
      "",
      `**${"Не удалось найти ".repeat(20)}**`,
    ].join("\n");
    const card = render(finished({ replyExcerpt: reply })).querySelector<HTMLElement>(
      ".attest-chat__agent-card",
    )!;
    const chip = card.querySelector<HTMLElement>(".attest-chat__agent-evidence")!;
    expect([
      card.querySelectorAll("a, img, script, iframe, .markdown-rendered").length,
      card.querySelector(".attest-chat__agent-markup-heading strong")?.textContent,
      card.querySelector(".attest-chat__agent-markup-paragraph strong")?.textContent,
      card.querySelector("em")?.textContent,
      card.querySelector("code")?.textContent,
      card.querySelectorAll("li").length,
      [chip.textContent, chip.title, chip.tagName],
      card.textContent!.includes("Find primary sources"),
      card.textContent!.includes("https://"),
      card.textContent!.includes("<img src=x onerror=alert(1)>"),
      card.querySelector(".attest-chat__agent-text")!.textContent!.endsWith("…"),
      card.querySelectorAll(".attest-chat__agent-open").length,
    ]).toEqual([
      0,
      "Findings",
      "Found",
      "date",
      "S-1",
      2,
      ["source 1", `[${TOKEN}]`, "SPAN"],
      false,
      false,
      true,
      true,
      1,
    ]);
    const toggle = card.querySelector<HTMLButtonElement>(".attest-chat__agent-toggle")!;
    expect(toggle.querySelector(".attest-chat__agent-toggle-chevron")).not.toBeNull();
    toggle.click();
    expect([
      toggle.getAttribute("aria-expanded"),
      toggle.textContent,
      card.querySelectorAll(".attest-chat__agent-markup strong").length,
      card.querySelector(".attest-chat__agent-text")!.textContent!.endsWith("…"),
    ]).toEqual(["true", "Show less", 3, false]);
  });

  it("shows the reply footer parts the notice carries and omits the rest", () => {
    const meta = (notice: SubAgentNoticeEntry) =>
      render(notice).querySelector(".attest-chat__agent-reply-meta")?.textContent ?? null;
    expect([
      meta(finished({ durationMs: 12_000, usage, modelLabel: "GPT-5" })),
      meta(finished({ usage: { ...usage, source: "unavailable" } })),
      meta(finished()),
    ]).toEqual(["0m 12s · Tool calls: 7 · 15.4k tokens · GPT-5", "Tool calls: 7", null]);
  });

  it("appends the terminal duration to a finished task status and leaves a live one bare", () => {
    const dispatch = {
      eventKey: "dispatch:p1:s1:r1",
      sessionId: "s1",
      runId: "r1",
      parentRunId: "p1",
      body: "Task",
      createdAt: "t",
      commandKind: "initial" as const,
      attempt: 1,
      sequence: 4,
    };
    const status = (notices: SubAgentNoticeEntry[]) => {
      const host = document.createElement("div");
      renderSubAgentTimelineItem(host, dispatchEvent(dispatch, notices), { t });
      return host.querySelector(".attest-chat__agent-status")!.textContent;
    };
    expect([
      status([finished({ durationMs: 12_000 })]),
      status([finished({ kind: "failed", durationMs: 61_000 })]),
      status([finished({ kind: "queued", durationMs: 3_000 })]),
      status([]),
    ]).toEqual(["Finished · 0m 12s", "Failed · 1m 01s", "Queued", "Running"]);
  });
});
