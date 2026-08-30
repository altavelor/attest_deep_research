import { ChatModelProvider, ChatRequest, ModelRoundProvider } from "@core/agent";
import { ResearchAnswer } from "@core/answer";
import type { ConversationRegistryPromptView } from "@core/chat/sourceRegistry";
import { buildAnswerDiagnostics } from "./strategies/answerDiagnostics";
import { verifyCitations } from "./strategies/citationVerification";
import {
  citationOccurrencesFromText,
  citationIdsFromText,
  mergeCitationRemovalCounts,
  mergeCitations,
  normalizeCitationTokens,
  removeUnknownCitationTokens,
  webUrlEvidenceIndex,
} from "./strategies/citations";
import {
  ContextDiagnostics,
  IndexDescriptionPromptContext,
  ToolCallDiagnostic,
} from "@core/diagnostics";
import { Citation } from "@core/model";
import { RetrievedChunk } from "@core/model";
import { AttestError } from "@core/errors";
import {
  AttachedFileManifestEntry,
  buildResearchPrompt,
  BuildResearchPromptOptions,
  estimateResearchRequestTokens,
  extractFollowUpQuestions,
  buildResearchSystemPrompt,
  labelResearchEvidence,
  rewriteCitationLabels,
  normalizeCitationDensityWithDiagnostics,
  ResearchChatHistoryMessage,
} from "@core/research";
import { formatCitation } from "@core/retrieval";
import { ResearchStreamEvent } from "@application/contracts/research";
import { createAsyncEventChannel } from "@application/AsyncEventChannel";
import { NoteToolService, ToolLoopEvent, ToolLoopRunner } from "@application/research/toolPorts";

export interface AnswerSynthesisServiceOptions {
  chatModel: ChatModelProvider;
  modelRound?: ModelRoundProvider;
  reasoning?: { enabled: boolean; effort?: string; summary: "off" | "auto" };
  reasoningDiagnostics?: Pick<
    NonNullable<ContextDiagnostics["reasoning"]>,
    "protocol" | "capabilitySource" | "summaryAvailable" | "observedFormats"
  >;
  chatModelName: string;
  chatOptions: Pick<ChatRequest, "temperature" | "maxTokens">;
  contextLimitTokens?: number;
  now: () => Date;
  persistFinalAnswer?: (answer: ResearchAnswer) => void | Promise<void>;
  noteTools?: NoteToolService;

  runToolLoop: ToolLoopRunner;
}

export interface AnswerSynthesisInput {
  question: string;
  chatHistory?: ResearchChatHistoryMessage[];
  evidence: RetrievedChunk[];
  explicitEvidence?: RetrievedChunk[];
  attachedFiles?: AttachedFileManifestEntry[];
  graphEvidence?: RetrievedChunk[];
  retrievedEvidence?: RetrievedChunk[];
  webEvidence?: RetrievedChunk[];
  conversationRegistry?: ConversationRegistryPromptView;
  finalizeAnswer?: (answer: ResearchAnswer) => ResearchAnswer;
  citations: Citation[];
  contextDiagnostics?: ContextDiagnostics;
  evidenceLimit: number;
  toolsEnabled?: boolean;
  retrievalDiagnostics?: string;
  indexDescription?: IndexDescriptionPromptContext;
  signal?: AbortSignal;
  fallback?: { reason: string };

  disableThinking?: boolean;
}

export class AnswerSynthesisService {
  private readonly chatModel: ChatModelProvider;
  private readonly chatModelName: string;
  private readonly chatOptions: Pick<ChatRequest, "temperature" | "maxTokens">;
  private readonly contextLimitTokens?: number;
  private readonly now: () => Date;
  private readonly persistFinalAnswer?: (answer: ResearchAnswer) => void | Promise<void>;
  private readonly noteTools?: NoteToolService;
  private readonly runToolLoop: ToolLoopRunner;
  private readonly modelRound?: ModelRoundProvider;
  private readonly reasoning?: AnswerSynthesisServiceOptions["reasoning"];
  private readonly reasoningDiagnostics?: AnswerSynthesisServiceOptions["reasoningDiagnostics"];

  constructor(options: AnswerSynthesisServiceOptions) {
    this.chatModel = options.chatModel;
    this.chatModelName = options.chatModelName;
    this.chatOptions = options.chatOptions;
    this.contextLimitTokens = options.contextLimitTokens;
    this.now = options.now;
    this.persistFinalAnswer = options.persistFinalAnswer;
    this.noteTools = options.noteTools;
    this.runToolLoop = options.runToolLoop;
    this.modelRound = options.modelRound;
    this.reasoning = options.reasoning;
    this.reasoningDiagnostics = options.reasoningDiagnostics;
  }

  async *synthesize(input: AnswerSynthesisInput): AsyncIterable<ResearchStreamEvent> {
    this.assertWithinContextWindow(input);
    const fallbackNotice = input.fallback
      ? `\n\nIMPORTANT: The research process could not complete (${input.fallback.reason}).\nYou are synthesizing a best-effort answer from PARTIAL results.\nBegin your response with a clear notice that the answer may be incomplete.\nDo not pretend to have complete information.`
      : "";
    const toolLoopEnabled = input.toolsEnabled === true && this.noteTools !== undefined;
    const systemPromptOptions = {
      indexDescription: input.indexDescription?.text,
      ...(toolLoopEnabled
        ? { noteToolNames: this.noteTools.definitions().map((def) => def.function.name) }
        : {}),
    };
    const promptOptions: BuildResearchPromptOptions = {
      question: input.question,
      chatHistory: input.chatHistory,
      evidence: input.evidence,
      explicitEvidence: input.explicitEvidence,
      attachedFiles: input.attachedFiles,
      noteToolsAvailable: toolLoopEnabled,
      graphEvidence: input.graphEvidence,
      retrievedEvidence: input.retrievedEvidence,
      webEvidence: input.webEvidence,
      conversationRegistry: input.conversationRegistry,
      maxEvidenceItems: input.evidenceLimit,
      retrievalDiagnostics: input.retrievalDiagnostics,
    };
    const prompt = buildResearchPrompt(promptOptions);
    let answerText = "";
    let toolDiagnostics: ToolCallDiagnostic[] = [];
    const reasoning = input.disableThinking
      ? { enabled: false, summary: "off" as const }
      : this.reasoning;
    const shouldExposeReasoning = reasoning?.enabled === true;

    yield { type: "status", message: "Synthesizing answer..." };

    const messages = [
      {
        role: "system" as const,
        content: buildResearchSystemPrompt(systemPromptOptions) + fallbackNotice,
      },
      { role: "user" as const, content: prompt },
    ];

    if (toolLoopEnabled) {
      const events = createAsyncEventChannel<ToolLoopEvent>();
      const resultPromise = this.runToolLoop({
        chatModel: this.chatModel,
        modelRound: this.modelRound,
        model: this.chatModelName,
        temperature: this.chatOptions.temperature,
        maxTokens: this.chatOptions.maxTokens,
        messages,
        tools: this.noteTools.definitions(),
        executeTool: (toolCall) => this.noteTools!.execute(toolCall),
        maxTotalResultChars: undefined,
        signal: input.signal,
        reasoning,
        onEvent: (event) => events.push(event),
      }).finally(() => events.close());
      for await (const event of events) {
        if (event.type === "delta") yield { type: "delta", content: event.content };
        else if (event.type === "reasoning" && shouldExposeReasoning) yield event;
        else if (
          event.type === "answer-reset" ||
          event.type === "checkpoint-delta" ||
          event.type === "checkpoint-complete" ||
          event.type === "checkpoint-promote" ||
          event.type === "tool-call-start" ||
          event.type === "tool-call-end"
        )
          yield event;
      }
      const result = await resultPromise;
      answerText = result.answerText;
      toolDiagnostics = result.diagnostics;
      this.applyReasoningDiagnostics(input.contextDiagnostics, reasoning, {
        reasoningItemCount: result.reasoningItemCount,
        continuationRounds: result.continuationRounds,
        ...result.usage,
      });
    } else if (this.modelRound) {
      const deltas = createAsyncEventChannel<import("@core/agent/protocol").ModelRoundDelta>();
      let streamedText = false;
      let streamedSummaries = false;
      const resultPromise = this.modelRound
        .runRound({
          model: this.chatModelName,
          temperature: this.chatOptions.temperature,
          maxTokens: this.chatOptions.maxTokens,
          messages,
          reasoning,
          signal: input.signal,
          onDelta: (delta) => {
            deltas.push(delta);
          },
        })
        .finally(() => deltas.close());
      for await (const delta of deltas) {
        if (delta.type === "text") {
          streamedText = true;
          yield { type: "delta", content: delta.text };
        } else if (shouldExposeReasoning) {
          streamedSummaries = true;
          yield {
            type: "reasoning",
            segmentId: delta.segmentId ?? "reasoning-0",
            content: delta.text,
          };
        }
      }
      const result = await resultPromise;
      if (result.stopReason !== "complete") {
        throw new AttestError({
          code: "MODEL_PROVIDER_UNAVAILABLE",
          message: "The model did not complete the synthesis round.",
          details: { reason: `model-round-${result.stopReason}` },
        });
      }
      if (shouldExposeReasoning && !streamedSummaries) {
        const summaries = result.items.filter((item) => item.type === "reasoningSummary");
        for (let index = 0; index < summaries.length; index += 1) {
          yield {
            type: "reasoning",
            segmentId: `reasoning-${index}`,
            content: summaries[index].text,
          };
        }
      }
      if (!streamedText) {
        for (const item of result.items) {
          if (item.type === "text") yield { type: "delta", content: item.text };
        }
      }
      answerText = result.items
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("");
      this.applyReasoningDiagnostics(input.contextDiagnostics, reasoning, {
        reasoningItemCount: result.reasoningItemCount ?? 0,
        continuationRounds: 0,
        ...(result.usage ?? { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 }),
      });
    } else {
      for await (const chunk of this.chatModel.streamChat({
        model: this.chatModelName,
        temperature: this.chatOptions.temperature,
        maxTokens: this.chatOptions.maxTokens,
        messages,
        signal: input.signal,
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

    const { byLabel } = labelResearchEvidence(promptOptions);
    const rewrite = rewriteCitationLabels(answerText, byLabel);
    const registryEvidence = input.conversationRegistry?.relevantEvidence ?? [];
    const citationEvidence = [...input.evidence, ...registryEvidence];
    const urlToEvidenceId = webUrlEvidenceIndex(citationEvidence);
    const normalized = normalizeCitationTokens(rewrite.text, urlToEvidenceId, {
      allowUnregisteredWebReferences: false,
    });
    const knownCitationIds = new Set(citationEvidence.map((chunk) => chunk.id));
    const webReferenceIds = new Set(normalized.webReferences.map((reference) => reference.id));
    const density = normalizeCitationDensityWithDiagnostics(
      removeUnknownCitationTokens(normalized.text, knownCitationIds),
      new Set([...knownCitationIds, ...webReferenceIds]),
    );
    answerText = density.text;
    const citedIds = citationIdsFromText(answerText, knownCitationIds);
    const citations = mergeCitations(
      input.citations,
      citationEvidence.map((chunk) => ({ ...formatCitation(chunk.source), id: chunk.id })),
    ).filter((citation) => citedIds.has(citation.id));

    let contextDiagnostics = appendToolDiagnostics(input.contextDiagnostics, toolDiagnostics);
    if (contextDiagnostics && rewrite.unknownLabels.length > 0) {
      const warning =
        `${rewrite.unknownLabels.length} citation label(s) the answer cited ` +
        "match no evidence and were removed — the model may have invented them.";
      contextDiagnostics = {
        ...contextDiagnostics,
        warnings: contextDiagnostics.warnings.includes(warning)
          ? contextDiagnostics.warnings
          : [...contextDiagnostics.warnings, warning],
      };
    }
    if (contextDiagnostics) {
      const unverifiedCitations = verifyCitations(answerText, citationEvidence, {
        urlToEvidenceId,
      });
      const normalizedUnknownIds = [...normalized.ids].filter(
        (id) => !knownCitationIds.has(id) && !webReferenceIds.has(id),
      );
      const unknownCitationIds = [
        ...new Set([
          ...rewrite.unknownLabels,
          ...normalizedUnknownIds,
          ...normalized.rejectedTokens,
        ]),
      ];
      const citationOccurrences = citationOccurrencesFromText(answerText, knownCitationIds);
      contextDiagnostics = {
        ...contextDiagnostics,
        answer: buildAnswerDiagnostics({
          answerText,
          promptSourceIds: citationEvidence.map((chunk) => chunk.id),
          citationLabels: [...knownCitationIds, ...webReferenceIds],
          collapsedOccurrences: normalized.collapsedOccurrences + density.removedOccurrences,
          collapsedByLabel: mergeCitationRemovalCounts(
            normalized.collapsedByLabel,
            density.removedByLabel,
          ),
          verificationRan: true,
          unknownCitationIds,
          unverifiedCitations,
          citationOccurrences,
        }),
      };
    }
    const unfinalizedAnswer: ResearchAnswer = {
      question: input.question,
      answer: answerText,
      citations,
      evidence: input.evidence,
      ...(normalized.webReferences.length > 0 ? { webReferences: normalized.webReferences } : {}),
      ...(contextDiagnostics ? { contextDiagnostics } : {}),
      followUpQuestions: extractFollowUpQuestions(answerText),
      createdAt: this.now().toISOString(),
      ...(input.fallback
        ? { isFallback: true as const, fallbackReason: input.fallback.reason }
        : {}),
    };
    const finalAnswer = input.finalizeAnswer?.(unfinalizedAnswer) ?? unfinalizedAnswer;

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
      conversationRegistry: input.conversationRegistry,
      maxEvidenceItems: input.evidenceLimit,
      retrievalDiagnostics: input.retrievalDiagnostics,
      reservedOutputTokens: this.chatOptions.maxTokens,
      systemPromptOptions: {
        indexDescription: input.indexDescription?.text,
      },
    });

    if (estimatedTokens <= this.contextLimitTokens) {
      return;
    }

    throw new AttestError({
      code: "CONTEXT_WINDOW_EXCEEDED",
      details: {
        contextLimitTokens: this.contextLimitTokens,
        estimatedTokens,
      },
    });
  }

  private applyReasoningDiagnostics(
    diagnostics: ContextDiagnostics | undefined,
    reasoning: AnswerSynthesisServiceOptions["reasoning"],
    counts: Pick<
      NonNullable<ContextDiagnostics["reasoning"]>,
      | "reasoningItemCount"
      | "continuationRounds"
      | "inputTokens"
      | "outputTokens"
      | "reasoningTokens"
    >,
  ): void {
    if (!diagnostics || !this.reasoningDiagnostics) return;
    diagnostics.reasoning = {
      ...this.reasoningDiagnostics,
      ...(reasoning?.effort ? { configuredEffort: reasoning.effort } : {}),
      summaryRequested: reasoning?.summary === "auto",
      ...counts,
    };
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
