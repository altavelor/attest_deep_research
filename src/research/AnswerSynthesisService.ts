import {
  ChatModelProvider,
  ChatRequest,
  Citation,
  ContextDiagnostics,
  ResearchAnswer,
  RetrievedChunk,
  ToolCallDiagnostic,
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
import { NoteToolService } from "./NoteTools";
import { runToolLoop } from "./ToolLoopRunner";

export interface AnswerSynthesisServiceOptions {
  chatModel: ChatModelProvider;
  chatModelName: string;
  chatOptions: Pick<ChatRequest, "temperature" | "maxTokens">;
  contextLimitTokens?: number;
  now: () => Date;
  persistFinalAnswer?: (answer: ResearchAnswer) => void | Promise<void>;
  noteTools?: NoteToolService;
}

export interface AnswerSynthesisInput {
  question: string;
  chatHistory?: ResearchChatHistoryMessage[];
  evidence: RetrievedChunk[];
  explicitEvidence?: RetrievedChunk[];
  graphEvidence?: RetrievedChunk[];
  retrievedEvidence?: RetrievedChunk[];
  webEvidence?: RetrievedChunk[];
  citations: Citation[];
  contextDiagnostics?: ContextDiagnostics;
  evidenceLimit: number;
  toolsEnabled?: boolean;
}

export class AnswerSynthesisService {
  private readonly chatModel: ChatModelProvider;
  private readonly chatModelName: string;
  private readonly chatOptions: Pick<ChatRequest, "temperature" | "maxTokens">;
  private readonly contextLimitTokens?: number;
  private readonly now: () => Date;
  private readonly persistFinalAnswer?: (answer: ResearchAnswer) => void | Promise<void>;
  private readonly noteTools?: NoteToolService;

  constructor(options: AnswerSynthesisServiceOptions) {
    this.chatModel = options.chatModel;
    this.chatModelName = options.chatModelName;
    this.chatOptions = options.chatOptions;
    this.contextLimitTokens = options.contextLimitTokens;
    this.now = options.now;
    this.persistFinalAnswer = options.persistFinalAnswer;
    this.noteTools = options.noteTools;
  }

  async *synthesize(input: AnswerSynthesisInput): AsyncIterable<ResearchStreamEvent> {
    this.assertWithinContextWindow(input);
    const prompt = buildResearchPrompt({
      question: input.question,
      chatHistory: input.chatHistory,
      evidence: input.evidence,
      explicitEvidence: input.explicitEvidence,
      graphEvidence: input.graphEvidence,
      retrievedEvidence: input.retrievedEvidence,
      webEvidence: input.webEvidence,
      maxEvidenceItems: input.evidenceLimit,
    });
    let answerText = "";
    let toolDiagnostics: ToolCallDiagnostic[] = [];

    yield { type: "status", message: "Synthesizing answer..." };

    const messages = [
      {
        role: "system" as const,
        content: RESEARCH_SYSTEM_PROMPT,
      },
      { role: "user" as const, content: prompt },
    ];

    if (input.toolsEnabled === true && this.noteTools) {
      const result = await runToolLoop({
        chatModel: this.chatModel,
        model: this.chatModelName,
        temperature: this.chatOptions.temperature,
        maxTokens: this.chatOptions.maxTokens,
        messages,
        tools: this.noteTools.definitions(),
        executeTool: (toolCall) => this.noteTools!.execute(toolCall),
      });
      answerText = result.answerText;
      toolDiagnostics = result.diagnostics;
      for (const event of result.events) {
        if (event.type === "delta" && event.content) {
          yield { type: "delta", content: event.content };
        }
      }
    } else {
      for await (const chunk of this.chatModel.streamChat({
        model: this.chatModelName,
        temperature: this.chatOptions.temperature,
        maxTokens: this.chatOptions.maxTokens,
        messages,
      })) {
        if (chunk.content) {
          answerText += chunk.content;
          yield { type: "delta", content: chunk.content };
        }

        if (chunk.isComplete) {
          break;
        }
      }
    }

    const contextDiagnostics = appendToolDiagnostics(
      input.contextDiagnostics,
      toolDiagnostics,
    );
    const finalAnswer: ResearchAnswer = {
      question: input.question,
      answer: answerText,
      citations: input.citations,
      evidence: input.evidence,
      ...(contextDiagnostics ? { contextDiagnostics } : {}),
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
      explicitEvidence: input.explicitEvidence,
      graphEvidence: input.graphEvidence,
      retrievedEvidence: input.retrievedEvidence,
      webEvidence: input.webEvidence,
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

function appendToolDiagnostics(
  diagnostics: ContextDiagnostics | undefined,
  tools: ToolCallDiagnostic[],
): ContextDiagnostics | undefined {
  if (!diagnostics) {
    return undefined;
  }

  return {
    ...diagnostics,
    tools: [...(diagnostics.tools ?? []), ...tools],
  };
}
