import { setIcon } from "obsidian";

import type { ParentTimelineEvent } from "@core/chat/subAgentPlacement";
import {
  renderSubAgentEventContent,
  subAgentEventIcon,
  subAgentEventKind,
  subAgentEventOptions,
} from "../subAgentEvents";
import type { TimelineScope } from "./timelineResources";

/** Renders one sub-agent dispatch or notice as a timeline node whose icon sits on the rail. */
export function renderAgentEventNode(
  listEl: HTMLElement,
  event: ParentTimelineEvent,
  scope: TimelineScope,
): void {
  const kind = subAgentEventKind(event);
  const key = event.kind === "agent-dispatch" ? event.dispatch.eventKey : event.notice.eventKey;
  const icon = subAgentEventIcon(event);
  const node = listEl.createDiv({
    cls: `attest-chat__workflow-node attest-chat__workflow-node--agent attest-chat__workflow-agent--${kind}`,
    attr: { "data-event-key": key },
  });
  setIcon(
    node.createSpan({
      cls: "attest-chat__workflow-dot attest-chat__workflow-dot--agent",
      attr: { "aria-hidden": "true", "data-icon": icon },
    }),
    icon,
  );
  const body = node.createDiv({ cls: "attest-chat__workflow-body attest-chat__workflow-agent" });
  const { t, onOpenSubAgentSession } = scope.context;
  renderSubAgentEventContent(body, event, subAgentEventOptions(t, onOpenSubAgentSession));
}
