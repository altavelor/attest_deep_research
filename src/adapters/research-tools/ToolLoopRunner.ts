import { ChatCompletionsRoundAdapter } from "@adapters/model-provider/chat/rounds/ChatCompletionsRoundAdapter";
import { ToolLabeler, runAgentLoop } from "@core/agent";
import { ToolLoopResult, ToolLoopRunnerOptions } from "@application/research";
import {
  toolCallChainLabel,
  resolveLabelFromResult,
  resolveResultSummary,
} from "@application/research";

export type { ToolLoopEvent, ToolLoopResult, ToolLoopRunnerOptions } from "@application/research";

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
