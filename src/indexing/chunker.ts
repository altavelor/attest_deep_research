import { createHash } from "crypto";

import { ExtractedChunk, MarkdownSourceReference } from "../shared/types";

export interface MarkdownChunkOptions {
  path: string;
  text: string;
  maxChunkLength?: number;
}

interface MarkdownSection {
  headingPath: string[];
  title: string;
  startOffset: number;
  text: string;
}

interface TextPart {
  text: string;
  startOffset: number;
  endOffset: number;
}

const DEFAULT_MAX_CHUNK_LENGTH = 1_600;
const BLOCK_ID_PATTERN = /\^([A-Za-z0-9_-]+)\s*$/m;

export function chunkMarkdown(options: MarkdownChunkOptions): ExtractedChunk[] {
  const maxChunkLength = options.maxChunkLength ?? DEFAULT_MAX_CHUNK_LENGTH;
  const content = stripFrontmatter(options.text);
  const sections = parseMarkdownSections(content.text, content.startOffset);

  return sections.flatMap((section) =>
    splitSection(section, maxChunkLength).map((part, index) =>
      createMarkdownChunk({
        path: options.path,
        section,
        part,
        chunkIndex: index,
      }),
    ),
  );
}

function stripFrontmatter(text: string): TextPart {
  if (!text.startsWith("---")) {
    return { text, startOffset: 0, endOffset: text.length };
  }

  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);

  if (!match) {
    return { text, startOffset: 0, endOffset: text.length };
  }

  return {
    text: text.slice(match[0].length),
    startOffset: match[0].length,
    endOffset: text.length,
  };
}

function parseMarkdownSections(text: string, baseOffset: number): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  const headingStack: string[] = [];
  let currentText = "";
  let currentStartOffset = baseOffset;
  let currentHeadingPath: string[] = [];
  let currentTitle = "Untitled";
  let offset = baseOffset;

  for (const line of splitLinesKeepingEndings(text)) {
    const heading = parseHeading(line);

    if (heading) {
      pushSection();
      headingStack.splice(heading.level - 1);
      headingStack[heading.level - 1] = heading.title;
      currentHeadingPath = headingStack.filter(Boolean);
      currentTitle = heading.title;
      currentStartOffset = offset + line.length;
      currentText = "";
    } else {
      if (!currentText) {
        currentStartOffset = offset;
      }

      currentText += line;
    }

    offset += line.length;
  }

  pushSection();

  return sections;

  function pushSection(): void {
    const trimmed = currentText.trim();

    if (!trimmed) {
      currentText = "";
      return;
    }

    const leadingWhitespaceLength = currentText.length - currentText.trimStart().length;

    sections.push({
      headingPath: [...currentHeadingPath],
      title: currentTitle,
      startOffset: currentStartOffset + leadingWhitespaceLength,
      text: trimmed,
    });
    currentText = "";
  }
}

function splitSection(section: MarkdownSection, maxChunkLength: number): TextPart[] {
  const paragraphs = splitParagraphs(section.text, section.startOffset);
  const parts: TextPart[] = [];
  let currentText = "";
  let currentStartOffset = section.startOffset;
  let currentEndOffset = section.startOffset;

  for (const paragraph of paragraphs) {
    if (paragraph.text.length > maxChunkLength) {
      flushCurrent();
      parts.push(...splitLongText(paragraph, maxChunkLength));
      continue;
    }

    const separator = currentText ? "\n\n" : "";
    const nextText = `${currentText}${separator}${paragraph.text}`;

    if (currentText && nextText.length > maxChunkLength) {
      flushCurrent();
    }

    if (!currentText) {
      currentStartOffset = paragraph.startOffset;
    }

    currentText = currentText ? `${currentText}\n\n${paragraph.text}` : paragraph.text;
    currentEndOffset = paragraph.endOffset;
  }

  flushCurrent();

  return parts;

  function flushCurrent(): void {
    if (!currentText) {
      return;
    }

    parts.push({
      text: currentText,
      startOffset: currentStartOffset,
      endOffset: currentEndOffset,
    });
    currentText = "";
  }
}

function splitParagraphs(text: string, baseOffset: number): TextPart[] {
  const paragraphs: TextPart[] = [];
  const paragraphPattern = /\S[\s\S]*?(?=\r?\n\s*\r?\n|$)/g;
  let match: RegExpExecArray | null;

  while ((match = paragraphPattern.exec(text)) !== null) {
    const raw = match[0];
    const trimmed = raw.trim();

    if (trimmed) {
      const leadingWhitespaceLength = raw.length - raw.trimStart().length;
      paragraphs.push({
        text: trimmed,
        startOffset: baseOffset + match.index + leadingWhitespaceLength,
        endOffset: baseOffset + match.index + leadingWhitespaceLength + trimmed.length,
      });
    }
  }

  return paragraphs;
}

function splitLongText(part: TextPart, maxChunkLength: number): TextPart[] {
  const chunks: TextPart[] = [];

  for (let start = 0; start < part.text.length; start += maxChunkLength) {
    const text = part.text.slice(start, start + maxChunkLength).trim();

    if (text) {
      chunks.push({
        text,
        startOffset: part.startOffset + start,
        endOffset: part.startOffset + start + text.length,
      });
    }
  }

  return chunks;
}

function createMarkdownChunk(options: {
  path: string;
  section: MarkdownSection;
  part: TextPart;
  chunkIndex: number;
}): ExtractedChunk {
  const blockId = findBlockId(options.part.text);
  const sourceId = blockId
    ? stableId(`${options.path}:block:${blockId}`)
    : stableId(
        `${options.path}:${options.part.startOffset}:${options.part.endOffset}:${options.chunkIndex}`,
      );
  const source: MarkdownSourceReference = {
    id: sourceId,
    kind: "markdown",
    path: options.path,
    title: options.section.title,
    headingPath: options.section.headingPath,
    startOffset: options.part.startOffset,
    endOffset: options.part.endOffset,
    ...(blockId ? { blockId } : {}),
  };

  return {
    id: sourceId,
    source,
    text: options.part.text,
    contentHash: stableId(options.part.text),
  };
}

function splitLinesKeepingEndings(text: string): string[] {
  return text.match(/.*(?:\r?\n|$)/g)?.filter((line) => line.length > 0) ?? [];
}

function parseHeading(line: string): { level: number; title: string } | null {
  const match = /^(#{1,6})\s+(.+?)\s*#*\s*(?:\r?\n)?$/.exec(line);

  if (!match) {
    return null;
  }

  return {
    level: match[1].length,
    title: match[2].trim(),
  };
}

function findBlockId(text: string): string | undefined {
  return BLOCK_ID_PATTERN.exec(text)?.[1];
}

function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
