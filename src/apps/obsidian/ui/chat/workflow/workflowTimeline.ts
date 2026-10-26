import type { ChainItem } from "@core/conversation";
import { fetchTargetsByResultId, fetchTargetsFor } from "./fetchTargetResolver";
import {
  renderSummaryNode,
  renderThinkingNode,
  renderWorkflowIndicator,
} from "./reasoningNodeRenderer";
import type { WorkflowRenderContext, WorkflowUiState } from "./renderContext";
import { TimelineResources, TimelineScope } from "./timelineResources";
import type { WorkflowTimelineHandle, WorkflowTimelineModel } from "./timelineModel";
import { renderToolNode } from "./toolCallNodeRenderer";
import { toolKey } from "./toolKey";

interface WorkflowState {
  isStreaming: boolean;
  isFinalizing: boolean;
  hasStreamingCheckpoint: boolean;
  showsPendingIndicator: boolean;
  uiState?: WorkflowUiState;
}

export function captureWorkflowUiState(hostEl: HTMLElement): WorkflowUiState {
  const openThinking = new Set<string>();
  hostEl.querySelectorAll<HTMLDetailsElement>("details[data-thinking-id]").forEach((el) => {
    if (el.open && el.dataset.thinkingId) openThinking.add(el.dataset.thinkingId);
  });
  const openOutputKey = hostEl.querySelector<HTMLElement>(
    ".attest-chat__tool-output-viewer[data-output-key]",
  )?.dataset.outputKey;
  return openOutputKey ? { openThinking, openOutputKey } : { openThinking };
}

/**
 * Renders one workflow timeline into the host and returns the handle that owns
 * its Markdown components, listeners, timers and inline output viewer. The
 * caller disposes the handle before replacing or discarding the host content.
 */
export function renderWorkflowTimeline(
  hostEl: HTMLElement,
  model: WorkflowTimelineModel,
  context: WorkflowRenderContext,
  uiState?: WorkflowUiState,
): WorkflowTimelineHandle {
  const resources = new TimelineResources(context, model.scopeId);
  const rendered = renderModel(
    hostEl,
    model,
    { scopeId: model.scopeId, context, resources },
    uiState,
  );
  const reopened = uiState?.openOutputKey
    ? findToolCall(model.items, model.scopeId, uiState.openOutputKey)
    : undefined;
  if (reopened && context.isDebugMode && context.outputViewerHost) {
    resources.openToolOutput(reopened);
  }
  return { rendered, dispose: () => resources.dispose() };
}

function findToolCall(
  items: readonly ChainItem[],
  scopeId: string,
  key: string,
): Extract<ChainItem, { kind: "tool-call" }> | undefined {
  for (const item of items) {
    if (item.kind !== "tool-call") continue;
    if (toolKey(scopeId, item) === key) return item;
    const nested = findToolCall(item.children ?? [], scopeId, key);
    if (nested) return nested;
  }
  return undefined;
}

function renderModel(
  hostEl: HTMLElement,
  model: WorkflowTimelineModel,
  scope: TimelineScope,
  uiState?: WorkflowUiState,
): boolean {
  const { items, reasoningSegments: segments, checkpoints } = model;
  const isStreaming = model.phase === "streaming";
  const showsPendingIndicator = model.mode !== "instant";
  if (
    segments.length === 0 &&
    checkpoints.length === 0 &&
    items.length === 0 &&
    !(isStreaming && showsPendingIndicator)
  ) {
    return false;
  }

  const state: WorkflowState = {
    isStreaming,
    isFinalizing: isStreaming && checkpoints.some((c) => c.status === "finalizing"),
    hasStreamingCheckpoint: checkpoints.some((c) => c.status === "streaming"),
    showsPendingIndicator,
    uiState,
  };
  const listEl = hostEl.createDiv({
    cls: "attest-chat__workflow",
    attr: { "data-workflow-scope": model.scopeId },
  });
  if (items.length > 0) renderChainNodes(listEl, items, scope, state);
  else renderLegacyNodes(listEl, model, scope, state);

  if (listEl.childElementCount === 0) {
    listEl.remove();
    return false;
  }
  return true;
}

function renderChainNodes(
  listEl: HTMLElement,
  chain: readonly ChainItem[],
  scope: TimelineScope,
  state: WorkflowState,
): void {
  const fetchTargets = fetchTargetsByResultId([...chain]);
  const latestItem = chain.at(-1);
  const activeReasoningId =
    state.isStreaming &&
    !state.isFinalizing &&
    !state.hasStreamingCheckpoint &&
    latestItem?.kind === "reasoning"
      ? latestItem.segmentId
      : undefined;
  const separators = attemptSeparators(scope);

  for (const item of chain) {
    if (item.kind === "reasoning") {
      renderThinkingNode(listEl, item.segmentId, item.content, {
        active: item.segmentId === activeReasoningId,
        scope,
        uiState: state.uiState,
      });
    } else if (item.kind === "checkpoint") {
      renderSummaryNode(listEl, item.content, scope);
    } else if (item.kind === "tool-call") {
      separators.before(listEl, item);
      renderToolNode(listEl, item, scope, item.fetchTargets ?? fetchTargetsFor(item, fetchTargets));
    }
  }
  if (state.showsPendingIndicator) {
    renderWorkflowIndicator(
      listEl,
      state.isStreaming,
      state.isFinalizing,
      state.hasStreamingCheckpoint,
      scope.context.t,
      activeReasoningId,
    );
  }
}

function attemptSeparators(scope: TimelineScope): {
  before(listEl: HTMLElement, item: Extract<ChainItem, { kind: "tool-call" }>): void;
} {
  const runs: string[] = [];
  let previousKey: string | undefined;
  return {
    before(listEl, item) {
      if (!item.attempt) return;
      const { runId, round } = item.attempt;
      if (!runs.includes(runId)) runs.push(runId);
      const key = `${runId}\u0000${round}`;
      if (previousKey !== undefined && key !== previousKey) {
        listEl.createDiv({
          cls: "attest-chat__workflow-separator",
          text: scope.context.t("chat.workflow.attempt", {
            run: String(runs.indexOf(runId) + 1),
            round: String(round),
          }),
        });
      }
      previousKey = key;
    },
  };
}

function renderLegacyNodes(
  listEl: HTMLElement,
  model: WorkflowTimelineModel,
  scope: TimelineScope,
  state: WorkflowState,
): void {
  const segments = model.reasoningSegments;
  segments.forEach((segment, index) => {
    renderThinkingNode(listEl, segment.id, segment.content, {
      active:
        state.isStreaming &&
        !state.isFinalizing &&
        !state.hasStreamingCheckpoint &&
        index === segments.length - 1,
      scope,
      uiState: state.uiState,
    });
  });
  for (const checkpoint of model.checkpoints) {
    if (checkpoint.status !== "finalizing") renderSummaryNode(listEl, checkpoint.content, scope);
  }
  if (state.showsPendingIndicator) {
    renderWorkflowIndicator(
      listEl,
      state.isStreaming,
      state.isFinalizing,
      state.hasStreamingCheckpoint,
      scope.context.t,
    );
  }
}
