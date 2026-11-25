// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTranslator } from "@adapters/i18n";
import { renderSubAgentTimelineItem } from "@apps/obsidian/ui/chat/subAgentEvents";
import { dispatchEvent } from "@core/chat/subAgentPlacement";
import type { NormalizedUsage, SubAgentNoticeEntry } from "@core/research";
import { installObsidianDomHelpers, resetDom } from "../../support/domHarness";

const t = createTranslator("en").t;
const TOKEN = `subagent:import-${"55e40e01".repeat(4)}:1`;
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
    expect(card.getAttribute("aria-label")).toBe("Find primary sources");
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
      meta(finished({ durationMs: 12_000, usage, modelLabel: "GPT\u202e-5\n" })),
      meta(finished({ durationMs: 400, usage: { ...usage, source: "unavailable" } })),
      meta(finished({ durationMs: 2.5, usage: { ...usage, toolCalls: 2.5, totalTokens: 1e302 } })),
      meta(finished()),
      meta(
        finished({
          usage: { ...usage, totalTokens: undefined, inputTokens: 900, outputTokens: 300 },
        }),
      ),
    ]).toEqual([
      "12s · Tool calls: 7 · 15.4k tokens · GPT-5",
      "0s",
      null,
      null,
      "Tool calls: 7 · 1.2k tokens",
    ]);
  });

  it("renders a run as one card with its status, usage, outcome reason, reply and folded task", () => {
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
    const card = (notices: SubAgentNoticeEntry[]): HTMLElement => {
      const host = document.createElement("div");
      renderSubAgentTimelineItem(host, dispatchEvent(dispatch, notices), {
        t,
        onOpenSubAgentSession: () => {},
      });
      return host;
    };
    const status = (notices: SubAgentNoticeEntry[]) =>
      card(notices).querySelector(".attest-chat__agent-status")!.textContent;
    expect([
      status([finished({ durationMs: 12_000 })]),
      status([finished({ kind: "failed", durationMs: 61_000 })]),
      status([finished({ kind: "queued", durationMs: 3_000 })]),
      status([]),
    ]).toEqual(["Finished", "Failed", "Queued", "Running"]);
    expect(
      card([finished({ kind: "queued" })]).querySelector(".attest-chat__agent-event-body")
        ?.textContent,
    ).toBe("Waiting for a free agent slot");

    const done = card([
      finished({ kind: "partial", durationMs: 12_000, usage, replyExcerpt: "Found it" }),
    ]);
    const command = done.querySelector<HTMLElement>(".attest-chat__agent-command")!;
    const open = done.querySelector<HTMLButtonElement>(".attest-chat__agent-open")!;
    expect([
      done.querySelectorAll(".attest-chat__agent-card").length,
      done.querySelector(".attest-chat__agent-run-title")!.textContent,
      done.querySelector(".attest-chat__agent-reply-meta")!.textContent,
      done.querySelector(".attest-chat__agent-event-body")!.textContent,
      done.querySelector(".attest-chat__agent-markup")!.textContent,
      [open.getAttribute("aria-label"), open.closest(".attest-chat__agent-card-head") !== null],
      command.hidden,
    ]).toEqual([
      1,
      "Find primary sources",
      "12s · Tool calls: 7 · 15.4k tokens",
      "The reply is partial; the agent can continue it.",
      "Found it",
      ["Open details", true],
      true,
    ]);
    [...done.querySelectorAll<HTMLButtonElement>(".attest-chat__agent-toggle")]
      .find((button) => button.textContent === "Show task")!
      .click();
    expect([command.hidden, command.textContent]).toEqual([false, "Task"]);
    const live = card([]);
    expect([
      live.querySelector<HTMLElement>(".attest-chat__agent-command")!.hidden,
      live.querySelector(".attest-chat__agent-reply-meta"),
    ]).toEqual([false, null]);
  });

  it("gives a created node without a task card exactly one Open details and a clean title", () => {
    const node = render(
      finished({ kind: "created", description: "Find\u202e sources\u200b\nnow" }),
    );
    const line = node.querySelector<HTMLElement>(".attest-chat__agent-event-description")!;
    expect([
      node.querySelectorAll(".attest-chat__agent-open").length,
      line.textContent,
      line.title,
    ]).toEqual([1, "Find sources now", "Find sources now"]);
  });
});
