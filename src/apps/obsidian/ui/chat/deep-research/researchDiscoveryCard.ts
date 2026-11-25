import {
  MAX_RESEARCH_TEXT_CHARS,
  currentHypotheses,
  type ResearchDiscovery,
  type ResearchHypothesis,
  type ResearchState,
  type ResearchTurnInput,
} from "@core/research/deepResearch";
import type { ResearchCardContext } from "./researchCardContext";
import { cancelAction, renderActions } from "./researchCardActions";

type HypothesisRowStatus =
  ResearchHypothesis["status"] | "awaiting" | "searching" | "queued" | "judging";

/**
 * Renders the hypotheses of a research inside its hypothesis stage: one row per current or
 * disconfirmed hypothesis with what its test is doing or its settled status, the observation
 * request while a supplied result is pending, and the research notes. A finished stage shows one
 * summary line; every model text is rendered as plain text.
 */
export function renderHypotheses(
  bodyEl: HTMLElement,
  state: ResearchState,
  discovery: ResearchDiscovery,
  context: ResearchCardContext,
  finished: boolean,
): void {
  const { t } = context;
  const shown = new Set(
    currentHypotheses(discovery.hypotheses).map(
      (entry) => `${entry.hypothesisId}#${entry.revision}`,
    ),
  );
  const hypotheses = discovery.hypotheses.filter(
    (entry) =>
      entry.status === "disconfirmed" || shown.has(`${entry.hypothesisId}#${entry.revision}`),
  );
  if (hypotheses.length === 0 && (finished || discovery.cycles.at(-1)?.decision !== "continue")) {
    bodyEl.createDiv({
      cls: "attest-research-stage__sub is-muted",
      text: t("chat.deepResearch.discovery.none"),
    });
    return;
  }
  if (finished) {
    const count = (status: ResearchHypothesis["status"]): number =>
      hypotheses.filter((entry) => entry.status === status).length;
    bodyEl.createDiv({
      cls: "attest-research-stage__sub",
      text: t("chat.deepResearch.progress.hypothesesDone", {
        count: hypotheses.length,
        supported: count("supported"),
        disconfirmed: count("disconfirmed"),
      }),
    });
    return;
  }
  const listEl = bodyEl.createEl("ul", { cls: "attest-research-stage__items" });
  for (const hypothesis of hypotheses) {
    const status = hypothesisStatus(discovery, hypothesis, context.running === true);
    const itemEl = listEl.createEl("li", {
      cls: `attest-research-stage__item is-${status}`,
      attr: {
        title: t("chat.deepResearch.discovery.alternative", {
          alternative: hypothesis.alternative,
        }),
      },
    });
    if (status === "searching") {
      itemEl.createSpan({ cls: "attest-research-stage__pulse", attr: { "aria-hidden": "true" } });
    }
    itemEl.createSpan({
      cls: "attest-research-stage__item-status",
      text: t(`chat.deepResearch.hypothesis.${status}`),
    });
    itemEl.createSpan({ cls: "attest-research-stage__item-text", text: hypothesis.claim });
  }
  if (listEl.childElementCount === 0) listEl.remove();
  if (state.pending?.kind === "observation" && !context.running) {
    renderObservationRequest(bodyEl, state, discovery, context);
  }
  if (discovery.notes.length === 0) return;
  const notesEl = bodyEl.createEl("details", { cls: "attest-research-card__notes" });
  notesEl.createEl("summary", {
    text: t("chat.deepResearch.discovery.notes", { count: discovery.notes.length }),
  });
  const notesList = notesEl.createEl("ol", { cls: "attest-research-card__branches" });
  for (const note of discovery.notes) {
    notesList.createEl("li", {
      cls: "attest-research-card__branch-notes",
      text: `${note.cycle} · ${note.attempted} → ${note.outcome} · ${note.decision} · ${note.nextAction}`,
    });
  }
}

function hypothesisStatus(
  discovery: ResearchDiscovery,
  hypothesis: ResearchHypothesis,
  running: boolean,
): HypothesisRowStatus {
  if (hypothesis.status !== "untested") return hypothesis.status;
  const test = discovery.tests
    .filter(
      (entry) =>
        entry.hypothesisId === hypothesis.hypothesisId &&
        entry.hypothesisRevision === hypothesis.revision,
    )
    .at(-1);
  if (test?.status === "awaiting-input") return "awaiting";
  if (test?.status !== "proposed" || !running) return "untested";
  const execution = discovery.executions.find((entry) => entry.workId === test.testId);
  if (execution?.state === "running") return "searching";
  return execution?.state === "completed" ? "judging" : "queued";
}

function renderObservationRequest(
  parentEl: HTMLElement,
  state: ResearchState,
  discovery: ResearchDiscovery,
  context: ResearchCardContext,
): void {
  const { t } = context;
  const test = discovery.tests.find((entry) => entry.testId === state.pending!.subjectId);
  if (!test) return;
  const requestEl = parentEl.createDiv({ cls: "attest-research-card__observation" });
  requestEl.createDiv({
    cls: "attest-research-card__branch-title",
    text: t("chat.deepResearch.observation.request", { method: test.method }),
  });
  requestEl.createDiv({
    cls: "attest-research-card__meta",
    text: t("chat.deepResearch.observation.hint"),
  });
  const field = requestEl.createEl("textarea", {
    cls: "attest-research-card__editor-task",
    attr: { maxlength: String(MAX_RESEARCH_TEXT_CHARS) },
  });
  const decide = (payload: unknown): ResearchTurnInput => ({
    type: "decision",
    decision: {
      researchId: state.researchId,
      decisionId: state.pending!.decisionId,
      expectedRevision: state.revision,
      payload,
    },
  });
  const skip = {
    label: t("chat.deepResearch.action.skipObservations"),
    turnLabel: t("chat.deepResearch.turn.skipObservations"),
    input: decide({ action: "skip-observations", testId: test.testId }),
  };
  renderActions(requestEl, state, context, [skip, cancelAction(state, t)], () => ({
    label: t("chat.deepResearch.action.observe"),
    turnLabel: t("chat.deepResearch.turn.observe"),
    input: decide({ action: "observe", testId: test.testId, text: field.value.trim() }),
    primary: true,
  }));
}
