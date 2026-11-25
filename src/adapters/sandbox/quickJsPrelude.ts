import type { ScriptFailureCode } from "@application/ports";

export type SerializedOutcome =
  | { kind: "json"; text: string }
  | { kind: "promise" }
  | { kind: "undefined" }
  | { kind: "non-finite" }
  | { kind: "error"; message: string };

export const PRELUDE_SOURCE = `(function (inputsJson, emit) {
  "use strict";
  const stringify = JSON.stringify;
  const PromiseCtor = Promise;
  const isFiniteNumber = Number.isFinite;
  const freeze = (value) => {
    if (value !== null && typeof value === "object") {
      Object.freeze(value);
      for (const key of Object.keys(value)) freeze(value[key]);
    }
    return value;
  };
  const format = (value) => {
    if (typeof value === "string") return value;
    try {
      const text = stringify(value);
      return text === undefined ? String(value) : text;
    } catch (error) {
      return String(value);
    }
  };
  Object.defineProperty(globalThis, "inputs", {
    value: freeze(JSON.parse(inputsJson)),
    enumerable: false,
    writable: false,
    configurable: false,
  });
  Object.defineProperty(globalThis, "console", {
    value: freeze({ log: (...args) => emit(args.map(format).join(" ")) }),
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return (value) => {
    if (value instanceof PromiseCtor) return { kind: "promise" };
    let nonFinite = false;
    let text;
    try {
      text = stringify(value, (key, entry) => {
        if (typeof entry === "number" && !isFiniteNumber(entry)) nonFinite = true;
        return entry;
      });
    } catch (error) {
      return { kind: "error", message: String(error && error.message ? error.message : error) };
    }
    if (text === undefined) return { kind: "undefined" };
    if (nonFinite) return { kind: "non-finite" };
    return { kind: "json", text };
  };
})`;

/** Maps a dumped QuickJS exception onto a failure code and a model-readable message. */
export function classifyScriptError(dumped: unknown): { code: ScriptFailureCode; message: string } {
  const name = errorField(dumped, "name");
  const message = errorField(dumped, "message") || describeThrown(dumped);
  if (/out of memory/i.test(message)) {
    return { code: "memory", message: "The script exceeded its memory limit." };
  }
  if (name === "SyntaxError") return { code: "syntax", message: `SyntaxError: ${message}` };
  return { code: "runtime", message: name ? `${name}: ${message}` : message };
}

function errorField(value: unknown, key: "name" | "message"): string {
  if (typeof value !== "object" || value === null) return "";
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : "";
}

function describeThrown(value: unknown): string {
  if (value === undefined || value === null) return "The script threw without a value.";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
