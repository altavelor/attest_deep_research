import { SUB_AGENT_RESULT_TOOL, SUB_AGENT_TOOL, SUB_AGENT_WAIT_TOOL } from "@core/agent/toolNames";
import type { ChainItem } from "./model";

/**
 * Projects a parent workflow chain for display. Nested child calls and phases are
 * dropped from every node, and a sub-agent tool node keeps only its call and status:
 * its output, current receipts, delivered or legacy child answers, never reaches the
 * parent view.
 */
export function parentWorkflowChain(chain: readonly ChainItem[]): ChainItem[] {
  return chain.map((item) => {
    if (item.kind !== "tool-call") return item;
    const { children: _children, phase: _phase, ...rest } = item;
    if (!isSubAgentTool(item.name)) return rest;
    const { resultJson: _resultJson, resultSummary: _resultSummary, ...call } = rest;
    return call;
  });
}

/** True for the parent tools whose output carries receipts or child answers. */
export function isSubAgentTool(name: string): boolean {
  return name === SUB_AGENT_TOOL || name === SUB_AGENT_RESULT_TOOL || name === SUB_AGENT_WAIT_TOOL;
}
