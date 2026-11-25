export type ScriptJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ScriptJsonValue[]
  | { readonly [key: string]: ScriptJsonValue };

export interface ScriptLimits {
  timeoutMs: number;
  memoryBytes: number;
  maxOutputChars: number;
}

export const DEFAULT_SCRIPT_LIMITS: Readonly<ScriptLimits> = Object.freeze({
  timeoutMs: 1_000,
  memoryBytes: 32 * 1024 * 1024,
  maxOutputChars: 16_000,
});

export type ScriptFailureCode =
  | "syntax"
  | "runtime"
  | "timeout"
  | "memory"
  | "output_too_large"
  | "non_serializable_result"
  | "invalid_arguments";

export interface ScriptRunRequest {
  code: string;
  inputs: ScriptJsonValue;
  limits: ScriptLimits;
}

export type ScriptRunResult =
  | { ok: true; result: ScriptJsonValue; logs: string[] }
  | { ok: false; code: ScriptFailureCode; message: string; logs: string[] };

/**
 * Runs a short synchronous script in an isolated interpreter. The script sees only
 * standard built-ins, a frozen `inputs` value and a captured `console.log`; every
 * failure is returned as a typed result instead of being thrown.
 */
export interface ScriptRunner {
  run(request: ScriptRunRequest): Promise<ScriptRunResult>;
}
