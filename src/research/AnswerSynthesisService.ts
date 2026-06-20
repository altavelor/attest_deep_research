import {
  ChatModelProvider,
  ChatRequest,
  Citation,
  ContextDiagnostics,
  ResearchAnswer,
  RetrievedChunk,
  ToolCallDiagnostic,
  IndexDescriptionPromptContext,
} from "../shared/types";
import { IxplorerError } from "../shared/errors";
import {
  buildResearchPrompt,
  estimateResearchRequestTokens,
  extractFollowUpQuestions,
  buildResearchSystemPrompt,
  ResearchChatHistoryMessage,
} from "./prompts";
import { ResearchStreamEvent } from "./types";
import { NoteToolService } from "./tools/NoteTools";
import { runToolLoop } from "./tools/ToolLoopRunner";
import { buildSkillCatalogPrompt, LoadedSkill, SkillDefinition } from "../skills/SkillRegistry";

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
  skillCatalog?: SkillDefinition[];
  selectedSkill?: SkillDefinition;
  inlineSkill?: LoadedSkill;
  retrievalDiagnostics?: string;
  skillToolResultChars?: number;
  indexDescription?: IndexDescriptionPromptContext;
  signal?: AbortSignal;
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
    const systemPromptOptions = {
      indexDescription: input.indexDescription?.text,
      skillCatalog: input.skillCatalog ? buildSkillCatalogPrompt(input.skillCatalog) : undefined,
      inlineSkill: input.inlineSkill
        ? {
            name: input.inlineSkill.skill.name,
            path: input.inlineSkill.skill.path,
            content: input.inlineSkill.content,
          }
        : undefined,
      requiredSkillPath: input.toolsEnabled === true ? input.selectedSkill?.path : undefined,
      toolsEnabled: input.toolsEnabled,
    };
    const prompt = buildResearchPrompt({
      question: input.question,
      chatHistory: input.chatHistory,
      evidence: input.evidence,
      explicitEvidence: input.explicitEvidence,
      graphEvidence: input.graphEvidence,
      retrievedEvidence: input.retrievedEvidence,
      webEvidence: input.webEvidence,
      maxEvidenceItems: input.evidenceLimit,
      retrievalDiagnostics: input.retrievalDiagnostics,
    });
    let answerText = "";
    let toolDiagnostics: ToolCallDiagnostic[] = [];

    yield { type: "status", message: "Synthesizing answer..." };

    const messages = [
      {
        role: "system" as const,
        content: buildResearchSystemPrompt(systemPromptOptions),
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
        maxTotalResultChars: input.skillToolResultChars,
        signal: input.signal,
      });
      answerText = result.answerText;
      toolDiagnostics = result.diagnostics;
      const loadedSkillPaths = new Set(
        toolDiagnostics
          .filter(
            (tool) =>
              tool.name === "read_note" &&
              tool.status === "success" &&
              typeof tool.metadata?.skillId === "string" &&
              typeof tool.arguments.path === "string",
          )
          .map((tool) => String(tool.arguments.path)),
      );
      if (loadedSkillPaths.size > 1) {
        throw new IxplorerError({
          code: "INVALID_SKILL_SELECTION",
          details: { reason: "multiple-skills", paths: [...loadedSkillPaths] },
        });
      }
      if (input.selectedSkill && !loadedSkillToolCall(toolDiagnostics, input.selectedSkill.path)) {
        throw new IxplorerError({
          code: "INVALID_SKILL_SELECTION",
          details: { reason: "skill-not-loaded", path: input.selectedSkill.path },
        });
      }
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

    const contextDiagnostics = applySkillToolDiagnostics(
      appendToolDiagnostics(input.contextDiagnostics, toolDiagnostics),
      toolDiagnostics,
      input.skillCatalog ?? [],
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
      retrievalDiagnostics: input.retrievalDiagnostics,
      reservedOutputTokens: this.chatOptions.maxTokens,
      systemPromptOptions: {
        indexDescription: input.indexDescription?.text,
        skillCatalog: input.skillCatalog ? buildSkillCatalogPrompt(input.skillCatalog) : undefined,
        inlineSkill: input.inlineSkill
          ? {
              name: input.inlineSkill.skill.name,
              path: input.inlineSkill.skill.path,
              content: input.inlineSkill.content,
            }
          : undefined,
        requiredSkillPath: input.toolsEnabled === true ? input.selectedSkill?.path : undefined,
        toolsEnabled: input.toolsEnabled,
      },
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

function loadedSkillToolCall(tools: ToolCallDiagnostic[], path: string): boolean {
  return tools.some(
    (tool) =>
      tool.name === "read_note" &&
      tool.status === "success" &&
      tool.arguments.path === path &&
      typeof tool.metadata?.skillId === "string",
  );
}

function applySkillToolDiagnostics(
  diagnostics: ContextDiagnostics | undefined,
  tools: ToolCallDiagnostic[],
  catalog: SkillDefinition[],
): ContextDiagnostics | undefined {
  if (!diagnostics?.skills) {
    return diagnostics;
  }
  const skillCall = tools.find(
    (tool) =>
      tool.name === "read_note" &&
      typeof tool.arguments.path === "string" &&
      catalog.some((skill) => skill.path === tool.arguments.path),
  );
  if (!skillCall) {
    return diagnostics;
  }
  const skill = catalog.find((candidate) => candidate.path === skillCall.arguments.path);
  if (!skill) {
    return diagnostics;
  }

  const loaded = skillCall.status === "success" && typeof skillCall.metadata?.skillId === "string";
  return {
    ...diagnostics,
    skills: {
      ...diagnostics.skills,
      selectedId: skill.id,
      selectedName: skill.name,
      selectedPath: skill.path,
      selectionMode: diagnostics.skills.selectionMode === "manual" ? "manual" : "automatic",
      loadMode: "read_note",
      loadStatus: loaded ? "loaded" : "failed",
      ...(loaded
        ? {
            loadedCharacters: Number(skillCall.metadata?.loadedCharacters ?? 0),
            loadedTokens: Number(skillCall.metadata?.loadedTokens ?? 0),
            truncated: false as const,
          }
        : { loadError: skillCall.reason ?? "skill-read-failed" }),
    },
  };
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
