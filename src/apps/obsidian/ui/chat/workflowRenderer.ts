import type { ChatDisplayMessage } from "@core/conversation";
import {
  captureWorkflowUiState,
  renderWorkflowTimeline,
  toParentWorkflowModel,
  WorkflowRenderContext,
  WorkflowTimelineHandle,
  WorkflowUiState,
} from "./workflow/index";

export type { WorkflowRenderContext, WorkflowUiState };
export { captureWorkflowUiState };

const handlesByOwner = new WeakMap<HTMLElement, Map<HTMLElement, WorkflowTimelineHandle>>();

/**
 * Renders a chat message's workflow through the shared timeline engine and keeps
 * the handle with its transcript, replacing a previous handle of the same host.
 */
export function renderWorkflowNodes(
  hostEl: HTMLElement,
  message: ChatDisplayMessage,
  context: WorkflowRenderContext,
  uiState?: WorkflowUiState,
): boolean {
  const owner = ownerOf(hostEl);
  const handles = handlesByOwner.get(owner) ?? new Map<HTMLElement, WorkflowTimelineHandle>();
  handlesByOwner.set(owner, handles);
  handles.get(hostEl)?.dispose();
  const handle = renderWorkflowTimeline(hostEl, toParentWorkflowModel(message), context, uiState);
  handles.set(hostEl, handle);
  return handle.rendered;
}

/** Disposes the timeline handles of one workflow host, or of every host when given the transcript. */
export function disposeWorkflowNodes(containerEl: HTMLElement): void {
  const owner = ownerOf(containerEl);
  const handles = handlesByOwner.get(owner);
  if (!handles) return;
  if (containerEl !== owner) {
    handles.get(containerEl)?.dispose();
    handles.delete(containerEl);
    return;
  }
  for (const handle of handles.values()) handle.dispose();
  handles.clear();
}

function ownerOf(el: HTMLElement): HTMLElement {
  return el.closest<HTMLElement>(".attest-chat__transcript") ?? el;
}
