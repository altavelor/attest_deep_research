import { ChatModelProvider, ChatRequest, Citation, ResearchAnswer, RetrievedChunk } from "../shared/types";
import { buildResearchPrompt, extractFollowUpQuestions } from "./prompts";
import { ResearchStreamEvent } from "./types";

export interface AnswerSynthesisServiceOptions {
  chatModel: ChatModelProvider;
  chatModelName: string;
  chatOptions: Pick<ChatRequest, "temperature" | "maxTokens">;
  now: () => Date;
  persistFinalAnswer?: (answer: ResearchAnswer) => void | Promise<void>;
}

export interface AnswerSynthesisInput {
  question: string;
  evidence: RetrievedChunk[];
  citations: Citation[];
  evidenceLimit: number;
}

export class AnswerSynthesisService {
  private readonly chatModel: ChatModelProvider;
  private readonly chatModelName: string;
  private readonly chatOptions: Pick<ChatRequest, "temperature" | "maxTokens">;
  private readonly now: () => Date;
  private readonly persistFinalAnswer?: (answer: ResearchAnswer) => void | Promise<void>;

  constructor(options: AnswerSynthesisServiceOptions) {
    this.chatModel = options.chatModel;
    this.chatModelName = options.chatModelName;
    this.chatOptions = options.chatOptions;
    this.now = options.now;
    this.persistFinalAnswer = options.persistFinalAnswer;
  }

  async *synthesize(input: AnswerSynthesisInput): AsyncIterable<ResearchStreamEvent> {
    const prompt = buildResearchPrompt({
      question: input.question,
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
          content:
            "You are Ixplorer, a local-first Obsidian research assistant. Answer only from provided evidence and preserve citation IDs.",
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
}
