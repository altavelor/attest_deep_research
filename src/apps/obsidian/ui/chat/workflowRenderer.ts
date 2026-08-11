import { App, Component } from "obsidian";

import { ChainItem, ChatDisplayMessage } from "@core/conversation";
import type { Translate } from "@adapters/i18n";
import { fetchTargetsByResultId, fetchTargetsFor } from "./workflow/fetchTargetResolver";
import {
  renderSummaryNode,
  renderThinkingNode,
  renderWorkflowIndicator,
} from "./workflow/reasoningNodeRenderer";
import { renderToolNode } from "./workflow/toolCallNodeRenderer";

export interface WorkflowRenderContext {
  app: App;
  markdownContext: Component;
  isDebugMode: boolean;
  t: Translate;
  onOpenToolOutput(item: Extract<ChainItem, { kind: "tool-call" }>): void;
}

export interface WorkflowUiState {
  openThinking: Set<string>;
}

export function captureWorkflowUiState(hostEl: HTMLElement): WorkflowUiState {
  const openThinking = new Set<string>();
  hostEl.querySelectorAll<HTMLDetailsElement>("details[data-thinking-id]").forEach((el) => {
    if (el.open && el.dataset.thinkingId) openThinking.add(el.dataset.thinkingId);
  });
  return { openThinking };
}

export function renderWorkflowNodes(
  hostEl: HTMLElement,
  message: ChatDisplayMessage,
  context: WorkflowRenderContext,
  uiState?: WorkflowUiState,
): boolean {
  const progress = message.researchProgress;
  const segments = progress?.reasoning.segments ?? [];
  const checkpoints = progress?.checkpoints ?? [];
  const chain = progress?.chain ?? [];
  const hasChain = chain.length > 0;
  const showsPendingIndicator = progress?.mode !== "instant";
  if (
    segments.length === 0 &&
    checkpoints.length === 0 &&
    !hasChain &&
    !(progress?.phase === "streaming" && showsPendingIndicator)
  ) {
    return false;
  }

  const isStreaming = progress?.phase === "streaming";
  const isFinalizing =
    isStreaming && checkpoints.some((checkpoint) => checkpoint.status === "finalizing");
  const hasStreamingCheckpoint = checkpoints.some(
    (checkpoint) => checkpoint.status === "streaming",
  );
  const listEl = hostEl.createDiv({ cls: "attest-chat__workflow" });

  const state: WorkflowState = {
    isStreaming,
    isFinalizing,
    hasStreamingCheckpoint,
    showsPendingIndicator,
    uiState,
  };
  if (hasChain) {
    renderChainNodes(listEl, chain, context, state);
  } else {
    renderLegacyNodes(listEl, segments, checkpoints, context, state);
  }

  if (listEl.childElementCount === 0) {
    listEl.remove();
    return false;
  }
  return true;
}

function renderChainNodes(
  listEl: HTMLElement,
  chain: ChainItem[],
  context: WorkflowRenderContext,
  state: WorkflowState,
): void {
  const fetchTargets = fetchTargetsByResultId(chain);
  const latestItem = chain.at(-1);
  const activeReasoningId =
    state.isStreaming &&
    !state.isFinalizing &&
    !state.hasStreamingCheckpoint &&
    latestItem?.kind === "reasoning"
      ? latestItem.segmentId
      : undefined;

  for (const item of chain) {
    if (item.kind === "reasoning") {
      renderThinkingNode(listEl, item.segmentId, item.content, {
        active: item.segmentId === activeReasoningId,
        renderContext: context,
        uiState: state.uiState,
      });
    } else if (item.kind === "checkpoint") {
      renderSummaryNode(listEl, item.content, context);
    } else if (item.kind === "tool-call") {
      renderToolNode(
        listEl,
        item,
        context,
        item.fetchTargets ?? fetchTargetsFor(item, fetchTargets),
      );
    }
  }
  if (state.showsPendingIndicator) {
    renderWorkflowIndicator(
      listEl,
      state.isStreaming,
      state.isFinalizing,
      state.hasStreamingCheckpoint,
      context.t,
      activeReasoningId,
    );
  }
}

function renderLegacyNodes(
  listEl: HTMLElement,
  segments: NonNullable<ChatDisplayMessage["researchProgress"]>["reasoning"]["segments"],
  checkpoints: NonNullable<ChatDisplayMessage["researchProgress"]>["checkpoints"],
  context: WorkflowRenderContext,
  state: WorkflowState,
): void {
  segments.forEach((segment, index) => {
    renderThinkingNode(listEl, segment.id, segment.content, {
      active:
        state.isStreaming &&
        !state.isFinalizing &&
        !state.hasStreamingCheckpoint &&
        index === segments.length - 1,
      renderContext: context,
      uiState: state.uiState,
    });
  });
  for (const checkpoint of checkpoints) {
    if (checkpoint.status !== "finalizing") renderSummaryNode(listEl, checkpoint.content, context);
  }
  if (state.showsPendingIndicator) {
    renderWorkflowIndicator(
      listEl,
      state.isStreaming,
      state.isFinalizing,
      state.hasStreamingCheckpoint,
      context.t,
    );
  }
}

interface WorkflowState {
  isStreaming: boolean;
  isFinalizing: boolean;
  hasStreamingCheckpoint: boolean;
  showsPendingIndicator: boolean;
  uiState?: WorkflowUiState;
}
