import {
  MAX_RESEARCH_TEXT_CHARS,
  currentHypotheses,
  type ResearchDiscovery,
  type ResearchState,
} from "@core/research/deepResearch";
import type { ResearchCardContext } from "./researchCardContext";
import { cancelAction, renderActions } from "./researchCardActions";

/**
 * Renders the discovery of a research: the hypothesis list with status and alternative, the
 * observation request while a supplied result is pending, and the research notes. Every model
 * text is rendered as plain text.
 */
export function renderDiscovery(
  cardEl: HTMLElement,
  state: ResearchState,
  discovery: ResearchDiscovery,
  context: ResearchCardContext,
): void {
  const { t } = context;
  const sectionEl = cardEl.createDiv({ cls: "attest-research-card__discovery" });
  sectionEl.createDiv({
    cls: "attest-research-card__title",
    text: t("chat.deepResearch.discovery.title"),
  });
  const shown = new Set(
    currentHypotheses(discovery.hypotheses).map(
      (entry) => `${entry.hypothesisId}#${entry.revision}`,
    ),
  );
  const hypotheses = discovery.hypotheses.filter(
    (entry) =>
      entry.status === "disconfirmed" || shown.has(`${entry.hypothesisId}#${entry.revision}`),
  );
  if (hypotheses.length === 0) {
    sectionEl.createDiv({
      cls: "attest-research-card__meta",
      text: t("chat.deepResearch.discovery.none"),
    });
  }
  const listEl = sectionEl.createEl("ol", { cls: "attest-research-card__branches" });
  for (const hypothesis of hypotheses) {
    const itemEl = listEl.createEl("li", {
      cls: `attest-research-card__branch attest-research-card__hypothesis--${hypothesis.status}`,
    });
    itemEl.createDiv({ cls: "attest-research-card__branch-title", text: hypothesis.claim });
    itemEl.createDiv({
      cls: "attest-research-card__branch-notes",
      text: t("chat.deepResearch.discovery.status", {
        status: t(`chat.deepResearch.hypothesis.${hypothesis.status}`),
        revision: hypothesis.revision,
        alternative: hypothesis.alternative,
      }),
    });
  }
  if (state.pending?.kind === "observation" && !context.running) {
    renderObservationRequest(sectionEl, state, discovery, context);
  }
  if (discovery.notes.length === 0) return;
  const notesEl = sectionEl.createEl("details", { cls: "attest-research-card__notes" });
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

function renderObservationRequest(
  parentEl: HTMLElement,
  state: ResearchState,
  discovery: ResearchDiscovery,
  context: ResearchCardContext,
): void {
  const { t } = context;
  const test = discovery.tests.find(
    (entry) =>
      entry.status === "awaiting-input" &&
      entry.hypothesisRevision === state.pending!.artifactRevision,
  );
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
  renderActions(requestEl, state, context, [cancelAction(state, t)], () => ({
    label: t("chat.deepResearch.action.observe"),
    turnLabel: t("chat.deepResearch.turn.observe"),
    input: {
      type: "decision",
      decision: {
        researchId: state.researchId,
        decisionId: state.pending!.decisionId,
        expectedRevision: state.revision,
        payload: { action: "observe", text: field.value.trim() },
      },
    },
    primary: true,
  }));
}
