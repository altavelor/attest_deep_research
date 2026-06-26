import { ChatToolCall, ChatToolDefinition } from "../../../core/agent/tool";

/**
 * Some local models (notably via Ollama chat templates that lack tool-call parsing)
 * emit tool calls as plain text in the content stream instead of as structured
 * `tool_calls`. Examples we have observed:
 *
 *   <tool_call>call:ixplorer.list_notes(path="")<tool_call>
 *   <tool_call>{"name": "list_notes", "arguments": {"path": ""}}</tool_call>
 *   ```tool_code
 *   list_notes(path="")
 *   ```
 *   {"name": "list_notes", "arguments": {}}
 *
 * This recovers structured calls from such text. Candidates are validated against
 * the tool names actually offered this turn, so prose that merely mentions a tool
 * name is not mistaken for a call.
 */
export function parseTextToolCalls(
  text: string,
  tools: readonly ChatToolDefinition[] | undefined,
): ChatToolCall[] {
  const known = new Set((tools ?? []).map((tool) => tool.function.name));
  if (known.size === 0 || !text.trim()) {
    return [];
  }

  const jsonCalls = parseJsonToolCalls(text, known);
  if (jsonCalls.length > 0) {
    return assignIds(jsonCalls);
  }

  return assignIds(parseFunctionCallSyntax(text, known));
}

interface RawToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

function parseJsonToolCalls(text: string, known: Set<string>): RawToolCall[] {
  const calls: RawToolCall[] = [];
  for (const candidate of extractJsonObjects(text)) {
    const nameValue =
      typeof candidate.name === "string"
        ? candidate.name
        : typeof candidate.tool === "string"
          ? candidate.tool
          : typeof candidate.tool_name === "string"
            ? candidate.tool_name
            : "";
    const name = stripNamespace(nameValue);
    if (!name || !known.has(name)) {
      continue;
    }
    const args = isRecord(candidate.arguments)
      ? candidate.arguments
      : isRecord(candidate.parameters)
        ? candidate.parameters
        : isRecord(candidate.args)
          ? candidate.args
          : {};
    calls.push({ name, arguments: args });
  }
  return calls;
}

// Matches `name(args)`, optionally namespaced (`ixplorer.list_notes(...)`) and
// optionally preceded by a `call:` style prefix handled by the leading boundary.
const FUNCTION_CALL_RE = /(?:^|[^\w.])((?:[A-Za-z_]\w*\.)*([A-Za-z_]\w*))\s*\(([\s\S]*?)\)/g;

function parseFunctionCallSyntax(text: string, known: Set<string>): RawToolCall[] {
  const calls: RawToolCall[] = [];
  for (const match of text.matchAll(FUNCTION_CALL_RE)) {
    const name = match[2];
    if (!known.has(name)) {
      continue;
    }
    calls.push({ name, arguments: parseArgList(match[3]) });
  }
  return calls;
}

function parseArgList(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  // `name({"path": ""})` — JSON object passed positionally.
  if (trimmed.startsWith("{")) {
    const parsed = tryParseJson(trimmed);
    if (isRecord(parsed)) {
      return parsed;
    }
  }
  // `path="", limit=5` keyword-argument form.
  const args: Record<string, unknown> = {};
  for (const pair of splitTopLevel(trimmed)) {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key) {
      args[key] = coerceScalar(value);
    }
  }
  return args;
}

function coerceScalar(value: string): unknown {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "None") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

// Splits on top-level commas, ignoring commas inside quotes or brackets.
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "{" || char === "[" || char === "(") {
      depth += 1;
    } else if (char === "}" || char === "]" || char === ")") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

// Scans for balanced `{...}` substrings and returns those that parse as objects.
function extractJsonObjects(text: string): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  let depth = 0;
  let start = -1;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === "\\") {
        i += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        const parsed = tryParseJson(text.slice(start, i + 1));
        if (isRecord(parsed)) {
          objects.push(parsed);
        }
        start = -1;
      }
    }
  }
  return objects;
}

function stripNamespace(name: string): string {
  const trimmed = name.trim();
  const lastDot = trimmed.lastIndexOf(".");
  return lastDot === -1 ? trimmed : trimmed.slice(lastDot + 1);
}

function assignIds(calls: RawToolCall[]): ChatToolCall[] {
  return calls.map((call, index) => ({
    id: `text_call_${index}`,
    name: call.name,
    arguments: call.arguments,
  }));
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
