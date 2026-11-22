import { SUB_AGENT_RESULT_TOOL, SUB_AGENT_TOOL, SUB_AGENT_WAIT_TOOL } from "@core/agent/toolNames";
import type { ChainItem } from "./model";

/**
 * Projects a parent workflow chain for display. A sub-agent tool node keeps only its call
 * and status: nested child calls, phases, receipts and delivered or legacy child answers
 * never reach the parent view, while other tools such as map_sources keep their nodes.
 */
export function parentWorkflowChain(chain: readonly ChainItem[]): ChainItem[] {
  return chain.map((item) => {
    if (item.kind !== "tool-call" || !isSubAgentTool(item.name)) return item;
    const {
      children: _children,
      phase: _phase,
      resultJson: _resultJson,
      resultSummary: _resultSummary,
      ...call
    } = item;
    return call;
  });
}

/**
 * Projects a parent workflow chain for the chat timeline: sub-agent tool rows are replaced
 * by the agent events shown in their place, except a failed call, which stays visible so
 * the user sees why no agent appeared.
 */
export function parentDisplayChain(chain: readonly ChainItem[]): ChainItem[] {
  return parentWorkflowChain(chain).filter((item) => !isHiddenSubAgentRow(item));
}

/** True for a sub-agent tool row the chat timeline replaces with agent events: any status but failed. */
export function isHiddenSubAgentRow(item: ChainItem): boolean {
  return item.kind === "tool-call" && isSubAgentTool(item.name) && item.status !== "failed";
}

/** True for the parent tools whose output carries receipts or child answers. */
export function isSubAgentTool(name: string): boolean {
  return name === SUB_AGENT_TOOL || name === SUB_AGENT_RESULT_TOOL || name === SUB_AGENT_WAIT_TOOL;
}
