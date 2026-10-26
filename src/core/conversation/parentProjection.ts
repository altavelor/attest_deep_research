import { SUB_AGENT_TOOL } from "@core/agent/toolNames";
import type { ChainItem } from "./model";

/**
 * Projects a parent workflow chain for display. Nested child calls and phases are
 * dropped from every node, and a run_subagent node keeps only its call and status:
 * its output, current receipts or a legacy child answer, never reaches the parent view.
 */
export function parentWorkflowChain(chain: readonly ChainItem[]): ChainItem[] {
  return chain.map((item) => {
    if (item.kind !== "tool-call") return item;
    const { children: _children, phase: _phase, ...rest } = item;
    if (item.name !== SUB_AGENT_TOOL) return rest;
    const { resultJson: _resultJson, resultSummary: _resultSummary, ...call } = rest;
    return call;
  });
}
