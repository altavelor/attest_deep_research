import type { ScriptJsonValue } from "@application/ports/scriptRunner";

export const SCRIPT_ARGUMENT_LIMITS = Object.freeze({
  codeChars: 8_000,
  inputsChars: 32_000,
  inputsDepth: 32,
  purposeChars: 160,
});

export interface ScriptArguments {
  code: string;
  inputs: ScriptJsonValue;
  purpose?: string;
}

export type ScriptArgumentsValidation =
  { ok: true; value: ScriptArguments } | { ok: false; message: string };

const ALLOWED_KEYS = new Set(["code", "inputs", "purpose"]);

/**
 * Validates untrusted `run_js` arguments: a non-empty bounded code string, JSON-only
 * inputs within a size and depth limit, and an optional short purpose. Every
 * rejection carries a message the model can act on.
 */
export function validateScriptArguments(input: Record<string, unknown>): ScriptArgumentsValidation {
  const unknownKey = Object.keys(input).find((key) => !ALLOWED_KEYS.has(key));
  if (unknownKey) return reject(`run_js does not accept "${unknownKey}".`);

  const code = typeof input.code === "string" ? input.code : undefined;
  if (code === undefined || code.trim() === "") return reject("code must be a non-empty string.");
  if (code.length > SCRIPT_ARGUMENT_LIMITS.codeChars) {
    return reject(`code is longer than ${SCRIPT_ARGUMENT_LIMITS.codeChars} characters.`);
  }

  const inputs = input.inputs === undefined ? null : input.inputs;
  const serialized = serializedLength(inputs);
  if (serialized === undefined) return reject("inputs must contain only JSON values.");
  if (serialized > SCRIPT_ARGUMENT_LIMITS.inputsChars) {
    return reject(
      `inputs are larger than ${SCRIPT_ARGUMENT_LIMITS.inputsChars} characters of JSON.`,
    );
  }
  const shapeError = jsonShapeError(inputs, 0);
  if (shapeError) return reject(`inputs ${shapeError}`);

  if (input.purpose !== undefined && typeof input.purpose !== "string") {
    return reject("purpose must be a string.");
  }
  const purpose = (input.purpose ?? "").trim().slice(0, SCRIPT_ARGUMENT_LIMITS.purposeChars);
  return {
    ok: true,
    value: { code, inputs: inputs as ScriptJsonValue, ...(purpose ? { purpose } : {}) },
  };
}

function jsonShapeError(value: unknown, depth: number): string | undefined {
  if (depth > SCRIPT_ARGUMENT_LIMITS.inputsDepth) {
    return `are nested deeper than ${SCRIPT_ARGUMENT_LIMITS.inputsDepth} levels.`;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return undefined;
  if (typeof value === "number") {
    return Number.isFinite(value) ? undefined : "must not contain NaN or Infinity.";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const error = jsonShapeError(item, depth + 1);
      if (error) return error;
    }
    return undefined;
  }
  if (typeof value === "object" && isPlainObject(value)) {
    for (const item of Object.values(value)) {
      const error = jsonShapeError(item, depth + 1);
      if (error) return error;
    }
    return undefined;
  }
  return "must contain only JSON values.";
}

function serializedLength(value: unknown): number | undefined {
  try {
    const text: unknown = JSON.stringify(value);
    return typeof text === "string" ? text.length : undefined;
  } catch {
    return undefined;
  }
}

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function reject(message: string): ScriptArgumentsValidation {
  return { ok: false, message };
}
