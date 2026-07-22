// Run trace: the central section of the diagnostic report. One collapsible
// card per thinking round — prompt Δ, tool calls with outcomes, reasoning size,
// text output — so the reader can replay why the model behaved the way it did.

import { ThinkingLoopRound, DiagnosticReportV3 } from "../report/types";
import {
  extractResultHint,
  formatCount,
  isEmptySearchResult,
  isNoteworthyRound,
  reasoningChars,
  toolCallSummary,
} from "../report/format";
import { badge, BadgeVariant, card, h } from "./primitives";

const ARGS_PREVIEW_CHARS = 160;

export function renderRunTrace(report: DiagnosticReportV3): string {
  const loop = report.reasoning.thinkingLoop;
  if (!loop || loop.rounds.length === 0) return "";
  const rounds = loop.rounds
    .map((round, index) => renderRound(round, loop.stopReasons[index]))
    .join("");
  return card("run-trace", "Run trace", rounds);
}

function renderRound(round: ThinkingLoopRound, stopReason: string | undefined): string {
  const phaseV: BadgeVariant =
    round.phase === "bootstrap" ? "accent" : round.phase === "repair" ? "warning" : "neutral";
  const thought = reasoningChars(round);
  const summaryBits = [
    `<strong>R${h(round.round)}</strong>`,
    badge(round.phase, phaseV),
    `<span>${h(toolCallSummary(round.toolCalls))}</span>`,
    thought > 0 ? `<span>💭 ${h(formatCount(thought))}</span>` : "",
    round.hadTextOutput ? `<span>✍ text</span>` : "",
    stopReason ? `<span class="muted">${h(stopReason)}</span>` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const body = [
    renderPromptDelta(round),
    ...round.toolCalls.map(renderToolCall),
    round.hadTextOutput
      ? `<div class="trace-text-output">✍ text output${round.classification ? ` → ${h(round.classification)}` : ""}</div>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  return `<details class="trace-round"${isNoteworthyRound(round) ? " open" : ""}>
    <summary class="trace-round-summary">${summaryBits}</summary>
    <div class="trace-round-body">${body}</div>
  </details>`;
}

function renderPromptDelta(round: ThinkingLoopRound): string {
  const delta = round.promptDelta;
  if (!delta || delta.messages.length === 0) return "";
  const totalChars = delta.messages.reduce((sum, message) => sum + message.chars, 0);
  const label =
    `Prompt Δ · ${delta.messages.length} message(s) · ${formatCount(totalChars)} chars` +
    `${delta.viaContinuation ? " · continuation" : ""} · toolChoice ${delta.toolChoice}`;
  const messages = delta.messages
    .map((m) => {
      const meta = [
        badge(m.role, m.role === "user" ? "accent" : "neutral"),
        `${h(formatCount(m.chars))} chars`,
        m.toolCallId ? `call <code>${h(m.toolCallId)}</code>` : null,
        m.toolCallNames?.length
          ? `calls: ${m.toolCallNames.map((name) => `<code>${h(name)}</code>`).join(" ")}`
          : null,
        m.truncatedChars ? badge(`+${formatCount(m.truncatedChars)} truncated`, "warning") : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const content = m.content ? `<pre class="args-pre">${h(m.content)}</pre>` : "";
      return `<div class="round-call">${meta}${content}</div>`;
    })
    .join("");
  return `<details class="trace-prompt-delta"><summary>${h(label)}</summary>${messages}</details>`;
}

function renderToolCall(call: ThinkingLoopRound["toolCalls"][number]): string {
  const empty = isEmptySearchResult(call);
  const status = call.status === "failed" ? "✗" : empty ? "∅" : "✓";
  const statusClass = call.status === "failed" ? "is-failed" : empty ? "is-empty" : "is-ok";
  const args = JSON.stringify(call.arguments);
  const argsHtml =
    args !== "{}"
      ? `<span class="trace-call-args">${h(args.length > ARGS_PREVIEW_CHARS ? `${args.slice(0, ARGS_PREVIEW_CHARS)}…` : args)}</span>`
      : "";
  const hint = empty ? extractResultHint(call) : null;
  return `<div class="trace-call ${statusClass}">
    <span class="trace-call-status">${status}</span>
    <code>${h(call.name)}</code>
    ${call.resultBytes !== undefined ? `<span class="muted">${h(formatCount(call.resultBytes))} B</span>` : ""}
    ${call.reason ? badge(call.reason, "warning") : ""}
    ${argsHtml}
    ${hint ? `<div class="trace-call-hint">⤷ ${h(hint)}</div>` : ""}
  </div>`;
}
