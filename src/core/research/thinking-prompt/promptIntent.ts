export interface PromptIntentInput {
  question: string;
  requiredTools: readonly string[];
}

export interface PromptIntent {
  compileKnowledge: boolean;
  download: boolean;
  compareDocuments: boolean;
  findContradictions: boolean;
  showVisuals: boolean;
}

const COMPILE_KNOWLEDGE = [
  /\bcompil\w*\b/,
  /\bknowledge\s+(base|graph|set)\b/,
  /\b(build|create)\b[^.?!]{0,40}\b(knowledge|wiki|zettelkasten)\w*\b/,
  /\b(linked|connected|interlinked)\s+(set\s+of\s+)?notes?\b/,
  /\bzettelkasten\b/,
  /скомпилир\w*/,
  /баз[ауые]\s+знаний/,
  /связанн\w*\s+(набор\w*\s+)?замет\w*/,
];

const DOWNLOAD = [
  /\bdownload\w*\b/,
  /\bsave\b[^.?!]{0,40}\b(pdf|file|document|paper|report)\b/,
  /\bfetch\b[^.?!]{0,30}\b(pdf|file)\b/,
  /скача\w*/,
  /загрузи\w*\s+(файл|документ|pdf)/,
  /сохрани\w*\s+(файл|документ|pdf)/,
];

const COMPARE_DOCUMENTS = [
  /\bcompare\b/,
  /\bcomparison\b/,
  /\bacross\s+(the\s+)?(documents?|papers?|sources?|corpus)\b/,
  /\beach\s+(document|paper|source)\b/,
  /\bconsensus\b/,
  /\bcoverage\s+(survey|across)\b/,
  /сравн\w*/,
  /по\s+каждому\s+документ\w*/,
];

const FIND_CONTRADICTIONS = [
  /\bcontradict\w*\b/,
  /\bdisagree\w*\b/,
  /\bconflict\w*\b/,
  /\binconsistenc\w*\b/,
  /противореч\w*/,
  /расхожден\w*/,
];

const SHOW_VISUALS = [
  /\bchart\b/,
  /\bgraph\b/,
  /\bplot\b/,
  /\bdiagram\b/,
  /\bvisuali[sz]\w*\b/,
  /\bimages?\b/,
  /\bgallery\b/,
  /\bphotos?\b/,
  /график\w*/,
  /диаграмм\w*/,
  /изображен\w*/,
  /картинк\w*/,
];

/**
 * Classifies which optional workflow modules the request actually calls for. The
 * classification is lexical and deterministic; a module whose intent is not matched
 * still gets its short universal form, never silence.
 */
export function classifyPromptIntent(input: PromptIntentInput): PromptIntent {
  const question = input.question.toLocaleLowerCase();
  const matches = (patterns: readonly RegExp[]): boolean =>
    patterns.some((pattern) => pattern.test(question));

  return {
    compileKnowledge: matches(COMPILE_KNOWLEDGE),
    download: matches(DOWNLOAD) || input.requiredTools.includes("download_document"),
    compareDocuments: matches(COMPARE_DOCUMENTS),
    findContradictions: matches(FIND_CONTRADICTIONS),
    showVisuals: matches(SHOW_VISUALS),
  };
}
