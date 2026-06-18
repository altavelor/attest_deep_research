import { ChatModelProvider } from "../shared/types";
import { collectChatText, parseLlmJsonObject } from "../shared/llmOutput";
import { buildSkillCatalogPrompt, SkillDefinition } from "./SkillRegistry";

export interface SkillSelectionServiceOptions {
  chatModel: ChatModelProvider;
  model: string;
  maxTokens?: number;
}

export interface SkillSelectionResult {
  skill?: SkillDefinition;
  warning?: "invalid-selector-output" | "unknown-skill-selection";
}

interface SelectorOutput {
  skill: string;
}

const DEFAULT_SELECTOR_MAX_TOKENS = 80;
const MAX_SELECTOR_OUTPUT_CHARS = 1_000;

export class SkillSelectionService {
  private readonly chatModel: ChatModelProvider;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: SkillSelectionServiceOptions) {
    this.chatModel = options.chatModel;
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? DEFAULT_SELECTOR_MAX_TOKENS;
  }

  async select(question: string, skills: SkillDefinition[]): Promise<SkillSelectionResult> {
    if (skills.length === 0) {
      return {};
    }

    const raw = await collectChatText(
      this.chatModel.streamChat({
        model: this.model,
        temperature: 0,
        maxTokens: this.maxTokens,
        messages: [
          {
            role: "system",
            content: [
              "Select at most one skill for the user's question.",
              'Return JSON only in the exact shape {"skill":"skill-id"}.',
              'Return {"skill":"none"} when no skill clearly applies.',
              "Use the final folder segment of the selected catalog path as skill-id.",
              "Do not answer the question.",
            ].join(" "),
          },
          {
            role: "user",
            content: `${buildSkillCatalogPrompt(skills)}\n\nQuestion: ${question}`,
          },
        ],
      }),
      { maxLength: MAX_SELECTOR_OUTPUT_CHARS + 1 },
    );

    let parseOk = false;
    const parsed = parseLlmJsonObject<SelectorOutput>(raw, {
      fallback: { skill: "none" },
      maxInputLength: MAX_SELECTOR_OUTPUT_CHARS,
      validate: isSelectorOutput,
      onDiagnostic: (diagnostic) => {
        parseOk = diagnostic.ok;
      },
    });
    if (!parseOk) {
      return { warning: "invalid-selector-output" };
    }

    const id = parsed.skill.trim().toLowerCase();
    if (id === "none") {
      return {};
    }
    const skill = skills.find((candidate) => candidate.id.toLowerCase() === id);
    return skill ? { skill } : { warning: "unknown-skill-selection" };
  }
}

function isSelectorOutput(value: unknown): value is SelectorOutput {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 1 &&
    typeof (value as { skill?: unknown }).skill === "string"
  );
}
