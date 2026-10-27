export const PSEUDO_TOOL_SCAN_LIMIT = 1_000_000;
const JSON_CANDIDATE_LIMIT = 8_192;
const TAG_NAME_LIMIT = 64;
const INLINE_CODE_RUN_LIMIT = 16;
const CALL_FENCE_INFOS = new Set(["tool_code", "tool_call"]);
const JSON_NAME_KEYS = ["name", "tool", "tool_name"] as const;

export interface PseudoToolCallStrip {
  text: string;
  toolNames: string[];
}

interface Span {
  end: number;
  toolName?: string;
}

/**
 * Removes pseudo tool-call markup that a model wrote as answer text for tools
 * in `known`: `<tool_call>` blocks, `<tool_NAME>` tags, `tool_code` fences and
 * bare `{"name": …}` objects. Fenced code blocks and inline code are never
 * rewritten, unknown names stay untouched, and the scan runs in linear time.
 */
export function stripPseudoToolCalls(
  text: string,
  known: ReadonlySet<string>,
): PseudoToolCallStrip {
  if (known.size === 0 || text.length > PSEUDO_TOOL_SCAN_LIMIT) return { text, toolNames: [] };
  const scanner = new PseudoToolScanner(text, known);
  return scanner.run();
}

class PseudoToolScanner {
  private readonly nextIndex = new Map<string, number>();
  private readonly parts: string[] = [];
  private readonly toolNames: string[] = [];
  private copyFrom = 0;

  constructor(
    private readonly text: string,
    private readonly known: ReadonlySet<string>,
  ) {}

  run(): PseudoToolCallStrip {
    const { text } = this;
    let index = 0;
    while (index < text.length) {
      const span = this.spanAt(index);
      if (!span) {
        index += 1;
        continue;
      }
      if (span.toolName) this.remove(index, span.end, span.toolName);
      index = Math.max(span.end, index + 1);
    }
    if (this.toolNames.length === 0) return { text, toolNames: [] };
    this.parts.push(text.slice(this.copyFrom));
    const cleaned = this.parts
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { text: cleaned, toolNames: [...new Set(this.toolNames)] };
  }

  private spanAt(index: number): Span | undefined {
    const char = this.text[index];
    if ((char === "`" || char === "~" || char === " ") && this.atLineStart(index)) {
      const fence = this.fenceAt(index);
      if (fence) return fence;
    }
    if (char === "`") return this.inlineCodeAt(index);
    if (char === "<") return this.tagAt(index);
    if (char === "{") return this.jsonAt(index);
    return undefined;
  }

  private atLineStart(index: number): boolean {
    return index === 0 || this.text[index - 1] === "\n";
  }

  private fenceAt(lineStart: number): Span | undefined {
    const { text } = this;
    let start = lineStart;
    while (start < text.length && start - lineStart < 3 && text[start] === " ") start += 1;
    const marker = text[start];
    if (marker !== "`" && marker !== "~") return undefined;
    const length = runLength(text, start, marker);
    if (length < 3) return undefined;
    const infoEnd = lineEnd(text, start);
    const info = text
      .slice(start + length, infoEnd)
      .trim()
      .split(/\s/, 1)[0]
      .toLowerCase();
    let cursor = infoEnd + 1;
    while (cursor < text.length) {
      const next = lineEnd(text, cursor);
      const line = text.slice(cursor, next).trim();
      if (line.length >= length && runLength(line, 0, marker) === line.length) {
        const end = Math.min(next + 1, text.length);
        if (!CALL_FENCE_INFOS.has(info)) return { end };
        return { end, toolName: this.callName(text.slice(infoEnd + 1, cursor)) };
      }
      cursor = next + 1;
    }
    return { end: text.length };
  }

  private inlineCodeAt(index: number): Span {
    const length = runLength(this.text, index, "`");
    if (length > INLINE_CODE_RUN_LIMIT) return { end: index + length };
    const close = this.find("`".repeat(length), index + length);
    return { end: close < 0 ? index + length : close + length };
  }

  private tagAt(index: number): Span | undefined {
    const { text } = this;
    const closing = text[index + 1] === "/";
    const nameStart = index + (closing ? 2 : 1);
    if (!text.startsWith("tool_", nameStart)) return undefined;
    let nameEnd = nameStart;
    while (
      nameEnd < text.length &&
      nameEnd - nameStart < TAG_NAME_LIMIT &&
      isTagChar(text[nameEnd])
    )
      nameEnd += 1;
    if (text[nameEnd] !== ">") return undefined;
    const tag = text.slice(nameStart, nameEnd);
    const bodyStart = nameEnd + 1;
    if (tag === "tool_call") {
      if (closing) return undefined;
      const close = this.firstOf(["</tool_call>", "<tool_call>"], bodyStart);
      const bodyEnd = close < 0 ? text.length : close;
      const toolName = this.callName(text.slice(bodyStart, bodyEnd));
      if (!toolName) return undefined;
      if (close < 0) return { end: text.length, toolName };
      return { end: close + (text[close + 1] === "/" ? 12 : 11), toolName };
    }
    const toolName = this.knownName(tag.slice("tool_".length));
    if (!toolName) return undefined;
    if (closing) return { end: bodyStart, toolName };
    const closeTag = `</${tag}>`;
    const close = this.find(closeTag, bodyStart);
    return { end: close < 0 ? text.length : close + closeTag.length, toolName };
  }

  private jsonAt(index: number): Span | undefined {
    const { text } = this;
    let keyStart = index + 1;
    while (keyStart < text.length && /\s/.test(text[keyStart]) && keyStart - index < 16)
      keyStart += 1;
    if (!JSON_NAME_KEYS.some((key) => text.startsWith(`"${key}"`, keyStart))) return undefined;
    const end = balancedObjectEnd(text, index);
    if (end < 0) return { end: Math.min(index + JSON_CANDIDATE_LIMIT, text.length) };
    return { end, toolName: this.callName(text.slice(index, end)) };
  }

  private callName(body: string): string | undefined {
    const trimmed = body.trim();
    if (trimmed.startsWith("{")) return this.jsonCallName(trimmed);
    const match = /^(?:call:)?([A-Za-z_][\w.]{0,127})\s*\(/.exec(trimmed);
    return match ? this.knownName(match[1]) : undefined;
  }

  private jsonCallName(body: string): string | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return undefined;
    }
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    const name = JSON_NAME_KEYS.map((key) => record[key]).find(
      (value) => typeof value === "string",
    );
    return typeof name === "string" ? this.knownName(name) : undefined;
  }

  private knownName(raw: string): string | undefined {
    const name = raw.slice(raw.lastIndexOf(".") + 1);
    return this.known.has(name) ? name : undefined;
  }

  private firstOf(needles: string[], from: number): number {
    const found = needles.map((needle) => this.find(needle, from)).filter((at) => at >= 0);
    return found.length === 0 ? -1 : Math.min(...found);
  }

  private find(needle: string, from: number): number {
    const cached = this.nextIndex.get(needle);
    if (cached !== undefined && (cached < 0 || cached >= from)) return cached;
    const at = this.text.indexOf(needle, from);
    this.nextIndex.set(needle, at);
    return at;
  }

  private remove(start: number, end: number, toolName: string): void {
    this.parts.push(this.text.slice(this.copyFrom, start));
    this.copyFrom = end;
    this.toolNames.push(toolName);
  }
}

function runLength(text: string, start: number, char: string): number {
  let end = start;
  while (end < text.length && text[end] === char) end += 1;
  return end - start;
}

function lineEnd(text: string, from: number): number {
  const at = text.indexOf("\n", from);
  return at < 0 ? text.length : at;
}

function isTagChar(char: string): boolean {
  return /[A-Za-z0-9_.-]/.test(char);
}

function balancedObjectEnd(text: string, start: number): number {
  const limit = Math.min(text.length, start + JSON_CANDIDATE_LIMIT);
  let depth = 0;
  let inString = false;
  for (let index = start; index < limit; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}
