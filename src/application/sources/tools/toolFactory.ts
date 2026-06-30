import {
  Tool,
  ToolContext,
  ToolExecution,
  ToolParseResult,
  ToolPermissions,
  toolFailure,
} from "../../../core/agent/tool";
import { ResearchRetriever } from "../../contracts/research";

// --- Field schema mini-DSL -------------------------------------------------
// Each field carries enough metadata to derive *both* the JSON schema sent to
// the model *and* the runtime parser, so the two can never drift. The allow-list
// of accepted properties is simply `Object.keys(schema)`.

type Described = { description?: string };

export type FieldSpec = Described &
  (
    | { kind: "string"; maxLength: number; required: boolean }
    | { kind: "text"; maxLength?: number; required: boolean }
    | { kind: "integer"; min: number; max: number; default: number }
    | { kind: "number" }
    | { kind: "boolean" }
    | { kind: "enum"; values: readonly string[]; required: boolean }
    | { kind: "stringArray"; maxItems: number; itemMaxLength: number }
  );

export type FieldSchema = Record<string, FieldSpec>;

export const str = (
  maxLength: number,
  opts: { required?: boolean; description?: string } = {},
): FieldSpec => ({
  kind: "string",
  maxLength,
  required: opts.required ?? false,
  ...(opts.description ? { description: opts.description } : {}),
});

export const int = (
  min: number,
  max: number,
  fallback: number,
  opts: Described = {},
): FieldSpec => ({
  kind: "integer",
  min,
  max,
  default: fallback,
  ...(opts.description ? { description: opts.description } : {}),
});

/** Free-form string preserved verbatim (no trimming) — for note bodies and other content. */
export const text = (
  opts: { required?: boolean; maxLength?: number; description?: string } = {},
): FieldSpec => ({
  kind: "text",
  required: opts.required ?? false,
  ...(opts.maxLength !== undefined ? { maxLength: opts.maxLength } : {}),
  ...(opts.description ? { description: opts.description } : {}),
});

/** Optional number: passed through when present, omitted otherwise (the service applies defaults). */
export const num = (opts: Described = {}): FieldSpec => ({
  kind: "number",
  ...(opts.description ? { description: opts.description } : {}),
});

export const bool = (opts: Described = {}): FieldSpec => ({
  kind: "boolean",
  ...(opts.description ? { description: opts.description } : {}),
});

export const enumOf = (
  values: readonly string[],
  opts: { required?: boolean; description?: string } = {},
): FieldSpec => ({
  kind: "enum",
  values,
  required: opts.required ?? false,
  ...(opts.description ? { description: opts.description } : {}),
});

export const strArray = (
  maxItems: number,
  itemMaxLength: number,
  opts: Described = {},
): FieldSpec => ({
  kind: "stringArray",
  maxItems,
  itemMaxLength,
  ...(opts.description ? { description: opts.description } : {}),
});

// --- Declarative tool definition -------------------------------------------

export interface ToolSpec<TDeps, TInput, TOutput> {
  name: string;
  description: string;
  /** Drives both the model-facing JSON schema and (by default) the parser. */
  schema: FieldSchema;
  /**
   * Optional parser override for tools whose validation/error codes are bespoke.
   * Receives the tool's deps so it can validate against them. Defaults to the
   * schema-driven parser (allow-list = `Object.keys(schema)`).
   */
  parse?: (input: Record<string, unknown>, deps: TDeps) => ToolParseResult<TInput>;
  execute: (deps: TDeps, input: TInput, context: ToolContext) => Promise<ToolExecution<TOutput>>;
  /** Permission gate evaluated by the ToolManager; absent ⇒ always available. */
  requires?: (permissions: ToolPermissions) => boolean;
}

/**
 * Build a {@link Tool} class from a declarative spec. Centralizes the boilerplate
 * shared by every tool: the `definition` wrapper and schema-driven `parseInput`.
 * The `execute` closure keeps full control (deps + context). Returned as a class
 * so call sites keep `new XxxTool(deps)`.
 */
export function defineTool<TDeps, TInput, TOutput>(
  spec: ToolSpec<TDeps, TInput, TOutput>,
): new (deps: TDeps) => Tool<TInput, TOutput> {
  const definition = toolDefinition(spec.name, spec.description, spec.schema);

  return class implements Tool<TInput, TOutput> {
    readonly definition = definition;
    readonly requires = spec.requires;

    constructor(private readonly deps: TDeps) {}

    parseInput(input: Record<string, unknown>): ToolParseResult<TInput> {
      return spec.parse
        ? spec.parse(input, this.deps)
        : (parseBySchema(input, spec.schema) as ToolParseResult<TInput>);
    }

    execute(input: TInput, context: ToolContext): Promise<ToolExecution<TOutput>> {
      return spec.execute(this.deps, input, context);
    }
  };
}

export interface InventoryToolSpec<TInput> {
  name: string;
  description: string;
  schema: FieldSchema;
  /** Method on the retriever that backs this tool; absence ⇒ "unsupported". */
  capability: keyof ResearchRetriever;
  /** Failure code + message used when the backing call throws. */
  errorCode: string;
  errorMessage: string;
  run(retriever: ResearchRetriever, input: TInput): Promise<unknown>;
  wrap(result: unknown, input: TInput): unknown;
}

/**
 * Convenience over {@link defineTool} for thin retriever-backed tools: adds the
 * capability-check, try/catch→failure, and result-wrapping the index tools share.
 */
export function defineInventoryTool<TInput>(
  spec: InventoryToolSpec<TInput>,
): new (retriever: ResearchRetriever) => Tool<TInput, unknown> {
  return defineTool<ResearchRetriever, TInput, unknown>({
    name: spec.name,
    description: spec.description,
    schema: spec.schema,
    execute: async (retriever, input) => {
      if (typeof retriever[spec.capability] !== "function") {
        return toolFailure(
          "index-inventory-unsupported",
          `${spec.name} is not supported by the selected index.`,
        );
      }
      try {
        return { ok: true, value: spec.wrap(await spec.run(retriever, input), input) };
      } catch {
        return toolFailure(spec.errorCode, spec.errorMessage, true);
      }
    },
  });
}

/** Build a model-facing tool definition from a field schema. */
export function toolDefinition(name: string, description: string, schema: FieldSchema) {
  return {
    type: "function" as const,
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties: toJsonSchema(schema),
        required: requiredKeys(schema),
        additionalProperties: false,
      },
    },
  };
}

// --- Shared result shaping --------------------------------------------------

export function okPage<T>(result: { items: T[]; nextCursor?: string }, limit: number): unknown {
  return { ...result, diagnostics: diagnostics(result.items.length, limit) };
}

export function diagnostics(resultCount: number, limit: number) {
  return { resultCount, limit, untrustedEvidence: true as const };
}

// --- Schema → JSON schema + parser -----------------------------------------

function toJsonSchema(schema: FieldSchema): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(schema)) {
    properties[name] = jsonSchemaForField(field);
  }
  return properties;
}

function jsonSchemaForField(field: FieldSpec): Record<string, unknown> {
  const described = field.description ? { description: field.description } : {};
  switch (field.kind) {
    case "string":
      return { type: "string", maxLength: field.maxLength, ...described };
    case "text":
      return {
        type: "string",
        ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
        ...described,
      };
    case "integer":
      return { type: "integer", minimum: field.min, maximum: field.max, ...described };
    case "number":
      return { type: "number", ...described };
    case "boolean":
      return { type: "boolean", ...described };
    case "enum":
      return { type: "string", enum: [...field.values], ...described };
    case "stringArray":
      return {
        type: "array",
        items: { type: "string", maxLength: field.itemMaxLength },
        maxItems: field.maxItems,
        ...described,
      };
  }
}

function requiredKeys(schema: FieldSchema): string[] {
  return Object.entries(schema)
    .filter(([, field]) => "required" in field && field.required)
    .map(([name]) => name);
}

function parseBySchema(
  input: Record<string, unknown>,
  schema: FieldSchema,
): ToolParseResult<Record<string, unknown>> {
  const allowed = Object.keys(schema);
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown) {
    return toolFailure("unknown-property", `Unknown property: ${unknown}.`);
  }

  const value: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(schema)) {
    const raw = input[name];
    switch (field.kind) {
      case "string": {
        const parsed = readOptionalString(raw, field.maxLength);
        if (parsed === false) return invalidField(name);
        if (parsed === undefined) {
          if (field.required) return invalidField(name);
          break;
        }
        value[name] = parsed;
        break;
      }
      case "text": {
        if (typeof raw !== "string") {
          if (raw === undefined && !field.required) break;
          return invalidField(name);
        }
        if (field.maxLength !== undefined && raw.length > field.maxLength) return invalidField(name);
        value[name] = raw;
        break;
      }
      case "number":
        if (typeof raw === "number" && Number.isFinite(raw)) value[name] = raw;
        break;
      case "integer":
        value[name] = readLimit(raw, field.default, field.max, field.min);
        break;
      case "boolean":
        if (typeof raw === "boolean") value[name] = raw;
        break;
      case "enum":
        if (typeof raw === "string" && field.values.includes(raw)) {
          value[name] = raw;
        } else if (field.required) {
          return invalidField(name);
        }
        break;
      case "stringArray": {
        const parsed = readStringArray(raw, field.maxItems, field.itemMaxLength);
        if (parsed === false) return invalidField(name);
        if (parsed !== undefined) value[name] = parsed;
        break;
      }
    }
  }

  return { ok: true, value };
}

function invalidField(name: string): ToolParseResult<never> {
  return toolFailure("invalid-input", `Property "${name}" is invalid or missing.`);
}

function readOptionalString(value: unknown, maxLength: number): string | false | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length <= maxLength ? trimmed : false;
}

function readStringArray(
  value: unknown,
  maxItems: number,
  itemMaxLength: number,
): string[] | false | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) return false;
  const items = value.map((item) => (typeof item === "string" ? item.trim() : ""));
  return items.every((item) => item.length > 0 && item.length <= itemMaxLength) ? items : false;
}

function readLimit(value: unknown, fallback: number, max: number, min: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}
