import type { ChatModelProvider, ChatRequest } from "@core/agent";
import type { ResearchChatHistoryMessage } from "@core/research";
import {
  RESEARCH_PRESET_LIMITS,
  MAX_RESEARCH_BRANCHES,
  deepResearchRejected,
  parsePlanDraft,
  planGenerationPrompt,
  type ResearchPlan,
  type ResearchPreset,
  type ResearchSourceScope,
} from "@core/research/deepResearch";

export interface ResearchPlanServiceOptions {
  chatModel: ChatModelProvider;
  model: string;
  chatOptions: Pick<ChatRequest, "temperature" | "maxTokens">;
  chatHistory?: readonly ResearchChatHistoryMessage[];
  signal?: AbortSignal;
  chatScope: ResearchSourceScope;
  preset: ResearchPreset;
  generationsUsed: number;
  createId(): string;
}

/**
 * Generates a reviewable research plan with one model call. The reply is untrusted: it is parsed
 * into a validated plan with host identifiers and preset limits, and any failure is readable.
 */
export class ResearchPlanService {
  constructor(private readonly options: ResearchPlanServiceOptions) {}

  async generate(question: string, instruction: string | null): Promise<ResearchPlan> {
    const { options } = this;
    const maxBranches = Math.min(
      MAX_RESEARCH_BRANCHES,
      RESEARCH_PRESET_LIMITS[options.preset].branches,
    );
    const request = instruction ? `${question}\n\nRevise the plan: ${instruction}` : question;
    let reply = "";
    try {
      for await (const chunk of options.chatModel.streamChat({
        model: options.model,
        temperature: options.chatOptions.temperature,
        maxTokens: options.chatOptions.maxTokens,
        messages: [
          { role: "system", content: planGenerationPrompt(maxBranches) },
          ...(options.chatHistory ?? []).map((message) => ({ ...message })),
          { role: "user", content: request },
        ],
        ...(options.signal ? { signal: options.signal } : {}),
      })) {
        reply += chunk.content;
      }
    } catch (error) {
      if ((error as { name?: unknown }).name === "AbortError") throw error;
      throw deepResearchRejected(
        "research-generation-failed",
        `The plan could not be generated: ${error instanceof Error ? error.message : "model error"}`,
      );
    }
    const parsed = parsePlanDraft(reply, {
      planId: options.createId(),
      preset: options.preset,
      chatScope: options.chatScope,
      generationsUsed: options.generationsUsed,
    });
    if (!parsed.ok) {
      throw deepResearchRejected(
        "research-generation-failed",
        `The plan could not be generated: ${parsed.message}`,
      );
    }
    return parsed.value;
  }
}
