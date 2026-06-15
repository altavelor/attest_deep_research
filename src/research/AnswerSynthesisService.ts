import {
  ChatModelProvider,
  ChatRequest,
  Citation,
  ResearchAnswer,
  RetrievedChunk,
} from "../shared/types";
import { IxplorerError } from "../shared/errors";
import {
  buildResearchPrompt,
  estimateResearchRequestTokens,
  extractFollowUpQuestions,
  RESEARCH_SYSTEM_PROMPT,
  ResearchChatHistoryMessage,
} from "./prompts";
import { ResearchStreamEvent } from "./types";

export interface AnswerSynthesisServiceOptions {
  chatModel: ChatModelProvider;
  chatModelName: string;
  chatOptions: Pick<ChatRequest, "temperature" | "maxTokens">;
  contextLimitTokens?: number;
  now: () => Date;
  persistFinalAnswer?: (answer: ResearchAnswer) => void | Promise<void>;
}

export interface AnswerSynthesisInput {
  question: string;
  chatHistory?: ResearchChatHistoryMessage[];
  evidence: RetrievedChunk[];
  citations: Citation[];
  evidenceLimit: number;
}

export class AnswerSynthesisService {
  private readonly chatModel: ChatModelProvider;
  private readonly chatModelName: string;
  private readonly chatOptions: Pick<ChatRequest, "temperature" | "maxTokens">;
  private readonly contextLimitTokens?: number;
  private readonly now: () => Date;
  private readonly persistFinalAnswer?: (answer: ResearchAnswer) => void | Promise<void>;

  constructor(options: AnswerSynthesisServiceOptions) {
    this.chatModel = options.chatModel;
    this.chatModelName = options.chatModelName;
    this.chatOptions = options.chatOptions;
    this.contextLimitTokens = options.contextLimitTokens;
    this.now = options.now;
    this.persistFinalAnswer = options.persistFinalAnswer;
  }

  async *synthesize(input: AnswerSynthesisInput): AsyncIterable<ResearchStreamEvent> {
    this.assertWithinContextWindow(input);
    const prompt = buildResearchPrompt({
      question: input.question,
      chatHistory: input.chatHistory,
      evidence: input.evidence,
      maxEvidenceItems: input.evidenceLimit,
    });
    let answerText = "";

    yield { type: "status", message: "Synthesizing answer..." };

    for await (const chunk of this.chatModel.streamChat({
      model: this.chatModelName,
      temperature: this.chatOptions.temperature,
      maxTokens: this.chatOptions.maxTokens,
      messages: [
        {
          role: "system",
          content: RESEARCH_SYSTEM_PROMPT,
        },
        { role: "user", content: prompt },
      ],
    })) {
      if (chunk.content) {
        answerText += chunk.content;
        yield { type: "delta", content: chunk.content };
      }

      if (chunk.isComplete) {
        break;
      }
    }

    const finalAnswer: ResearchAnswer = {
      question: input.question,
      answer: answerText,
      citations: input.citations,
      evidence: input.evidence,
      followUpQuestions: extractFollowUpQuestions(answerText),
      createdAt: this.now().toISOString(),
    };

    if (this.persistFinalAnswer) {
      await this.persistFinalAnswer(finalAnswer);
    }

    yield { type: "complete", answer: finalAnswer };
  }

  private assertWithinContextWindow(input: AnswerSynthesisInput): void {
    if (!this.contextLimitTokens) {
      return;
    }

    const estimatedTokens = estimateResearchRequestTokens({
      question: input.question,
      chatHistory: input.chatHistory,
      evidence: input.evidence,
      maxEvidenceItems: input.evidenceLimit,
      reservedOutputTokens: this.chatOptions.maxTokens,
    });

    if (estimatedTokens <= this.contextLimitTokens) {
      return;
    }

    throw new IxplorerError({
      code: "CONTEXT_WINDOW_EXCEEDED",
      details: {
        contextLimitTokens: this.contextLimitTokens,
        estimatedTokens,
      },
    });
  }
}
