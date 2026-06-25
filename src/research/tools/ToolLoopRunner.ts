// Research wrapper around the core agent loop (stage 3). The pure loop lives in
// core/agent/AgentLoop; this wrapper supplies the two research/client concerns
// the core deliberately doesn't know about:
//   1. a default ModelRoundProvider built from a ChatModelProvider (chat-completions adapter);
//   2. the research-specific tool labeler.
// The existing ToolLoopRunnerOptions API (with chatModel) is preserved for callers.

import { ChatModelProvider } from "../../shared/types";
import { ChatCompletionsRoundAdapter } from "../../client/chat/ChatCompletionsRoundAdapter";
import {
  AgentLoopEvent,
  AgentLoopOptions,
  AgentLoopResult,
  ToolLabeler,
  runAgentLoop,
} from "../../core/agent/AgentLoop";
import { toolCallChainLabel, resolveLabelFromResult, resolveResultSummary } from "./toolCallLabel";

export type ToolLoopEvent = AgentLoopEvent;
export type ToolLoopResult = AgentLoopResult;

export interface ToolLoopRunnerOptions extends Omit<AgentLoopOptions, "modelRound" | "labeler"> {
  chatModel: ChatModelProvider;
  modelRound?: AgentLoopOptions["modelRound"];
}

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
