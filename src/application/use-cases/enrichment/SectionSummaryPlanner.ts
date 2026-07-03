import { IndexSectionOutline, IndexSourceOutline } from "@application/ports";

export const MAX_SECTIONS_PER_SOURCE = 30;
export const SECTION_TEXT_CHARS = 6_000;
export const SMALL_DOCUMENT_CHUNK_LIMIT = 2;
export const SMALL_DOCUMENT_CHAR_LIMIT = 2_500;

const MIN_SECTION_CHUNKS = 1;
const SHORT_SECTION_CHAR_LIMIT = 750;
const MAX_MERGED_SECTION_TEXT_CHARS = SECTION_TEXT_CHARS;
const LOW_VALUE_HEADING =
  /^(references?|bibliography|literature|works cited|acknowledgements?|appendix|appendices)$/i;

export interface PreparedSection {
  headingPath: string[];
  chunkStart: number;
  chunkEnd: number;
  charCount: number;
  text: string;
  sectionHash: string;
}

export interface SectionSummaryGroup {
  headingPath: string[];
  chunkStart: number;
  chunkEnd: number;
  text: string;
  sectionHash: string;
}

export function shouldUseSmallDocumentFastPath(
  outline: IndexSourceOutline | null | undefined,
): boolean {
  return Boolean(
    outline &&
    (outline.chunkCount <= SMALL_DOCUMENT_CHUNK_LIMIT ||
      outline.charCount <= SMALL_DOCUMENT_CHAR_LIMIT),
  );
}

export function summarizableSections(
  outline: IndexSourceOutline | null | undefined,
): IndexSectionOutline[] {
  return (outline?.sections ?? []).filter(isSummarizableSection).slice(0, MAX_SECTIONS_PER_SOURCE);
}

export function buildSectionSummaryGroups(sections: PreparedSection[]): SectionSummaryGroup[] {
  const groups: SectionSummaryGroup[] = [];
  let pending: PreparedSection[] = [];

  const flushPending = () => {
    if (pending.length === 0) {
      return;
    }
    groups.push(toSummaryGroup(pending));
    pending = [];
  };

  for (const section of sections) {
    if (section.charCount <= SHORT_SECTION_CHAR_LIMIT) {
      const pendingTextLength = pending.reduce((sum, item) => sum + item.text.length, 0);
      if (pendingTextLength + section.text.length <= MAX_MERGED_SECTION_TEXT_CHARS) {
        pending.push(section);
        continue;
      }
      flushPending();
    }
    flushPending();
    groups.push(toSummaryGroup([section]));
  }
  flushPending();

  return groups;
}

export function sectionTextHash(headingPath: string[], text: string): string {
  return stableHash(`${headingPath.join("\0")}\0${text}`);
}

function isSummarizableSection(section: IndexSectionOutline): boolean {
  const leaf = section.headingPath.at(-1)?.trim() ?? "";
  return (
    section.headingPath.length > 0 &&
    section.chunkCount >= MIN_SECTION_CHUNKS &&
    !LOW_VALUE_HEADING.test(leaf)
  );
}

function toSummaryGroup(sections: PreparedSection[]): SectionSummaryGroup {
  const text = sections
    .map((section) => `Section: ${section.headingPath.join(" > ")}\n${section.text}`)
    .join("\n\n")
    .slice(0, MAX_MERGED_SECTION_TEXT_CHARS);
  return {
    headingPath: sections.flatMap((section) => section.headingPath.at(-1) ?? section.headingPath),
    chunkStart: Math.min(...sections.map((section) => section.chunkStart)),
    chunkEnd: Math.max(...sections.map((section) => section.chunkEnd)),
    text,
    sectionHash: stableHash(
      sections
        .map((section) => `${section.headingPath.join("\0")}\0${section.sectionHash}`)
        .join("\0"),
    ),
  };
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
