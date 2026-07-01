// Research wrapper around the core agent loop (stage 3). The pure loop lives in
// core/agent/AgentLoop; this wrapper supplies the two research/client concerns
// the core deliberately doesn't know about:
//   1. a default ModelRoundProvider built from a ChatModelProvider (chat-completions adapter);
//   2. the research-specific tool labeler.
// The existing ToolLoopRunnerOptions API (with chatModel) is preserved for callers.

import { ChatCompletionsRoundAdapter } from "../model-provider/chat/rounds/ChatCompletionsRoundAdapter";
import { ToolLabeler, runAgentLoop } from "@core/agent";
import {
  ToolLoopResult,
  ToolLoopRunnerOptions,
} from "../../application/research/toolPorts";
import { toolCallChainLabel, resolveLabelFromResult, resolveResultSummary } from "../../application/research/toolCallLabel";

export type { ToolLoopEvent, ToolLoopResult, ToolLoopRunnerOptions } from "../../application/research/toolPorts";

const RESEARCH_TOOL_LABELER: ToolLabeler = {
  chainLabel: toolCallChainLabel,
  labelFromResult: resolveLabelFromResult,
  resultSummary: resolveResultSummary,
};

export function runToolLoop(options: ToolLoopRunnerOptions): Promise<ToolLoopResult> {
  const { chatModel, modelRound, ...rest } = options;
  return runAgentLoop({
    ...rest,
    modelRound: modelRound ?? new ChatCompletionsRoundAdapter(chatModel),
    labeler: RESEARCH_TOOL_LABELER,
  });
}
