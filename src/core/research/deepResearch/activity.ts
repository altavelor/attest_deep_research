export type ResearchStage = "hypotheses" | "writing";

export interface ResearchStageTime {
  startedAt: number;
  endedAt?: number;
}

export type ResearchStep =
  | { kind: "proposing"; cycle: number }
  | { kind: "testing"; cycle: number }
  | { kind: "judging"; cycle: number; done: number; total: number }
  | { kind: "writing"; words: number; headings: readonly string[]; thinking?: number };

export interface ResearchActivityBudget {
  activeMs: number;
  modelRounds: number;
  branchAttempts: number;
}

export interface ResearchActivity {
  researchId: string;
  at: number;
  stage: ResearchStage;
  stages: Readonly<Partial<Record<ResearchStage, ResearchStageTime>>>;
  step: ResearchStep;
  budget: ResearchActivityBudget;
}

export interface WritingSection {
  title: string;
  status: "done" | "current" | "pending";
}

const MAX_HEADINGS = 24;
const MAX_HEADING_CHARS = 120;
const HEADING = /^#{1,3}\s+(.+?)\s*#*\s*$/;

/**
 * Reads the progress of a report being written from its streamed markdown: the word count and the
 * headings written so far, bounded in number and length, and the words the model reasoned before.
 */
export function writingStep(
  markdown: string,
  thinking = 0,
): Extract<ResearchStep, { kind: "writing" }> {
  const headings: string[] = [];
  for (const line of markdown.split("\n")) {
    const match = HEADING.exec(line.trim());
    if (!match || headings.length >= MAX_HEADINGS) continue;
    headings.push(match[1]!.slice(0, MAX_HEADING_CHARS));
  }
  const words = markdown.match(/\S+/g)?.length ?? 0;
  return thinking > 0
    ? { kind: "writing", words, headings, thinking }
    : { kind: "writing", words, headings };
}

/**
 * Lists the sections of a report being written: every written heading but the last is done, the
 * last is being written, and the outline headings not written yet follow as pending.
 */
export function writingSections(
  outline: readonly string[],
  headings: readonly string[],
): WritingSection[] {
  const written = new Set(headings.map(sectionKey));
  return [
    ...headings.map((title, index) => ({
      title,
      status: index === headings.length - 1 ? ("current" as const) : ("done" as const),
    })),
    ...outline
      .filter((title) => !written.has(sectionKey(title)))
      .map((title) => ({ title, status: "pending" as const })),
  ];
}

/** Formats a duration as minutes and seconds. */
export function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function sectionKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/^[\d.\s)]+/, "")
    .replace(/[*_`]/g, "")
    .trim();
}
