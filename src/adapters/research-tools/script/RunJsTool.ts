import { RUN_JS_TOOL, toolFailure, type ToolParseResult } from "@core/agent";
import {
  DEFAULT_SCRIPT_LIMITS,
  type ScriptJsonValue,
  type ScriptLimits,
  type ScriptRunner,
} from "@application/ports";
import type { ComputationRecorder } from "@application/sources";
import { raw, text, str } from "@application/sources/tools";
import { defineTool } from "@application/sources/tools";
import {
  SCRIPT_ARGUMENT_LIMITS,
  validateScriptArguments,
  type ScriptArguments,
} from "@application/research";

export interface RunJsToolDeps {
  runner: ScriptRunner;
  recorder: ComputationRecorder;
  limits?: ScriptLimits;
}

export interface RunJsOutput {
  computationId: string;
  result: ScriptJsonValue;
  logs: string[];
}

/**
 * Runs a short synchronous JavaScript calculation in the isolated script sandbox and
 * records each successful run as a computation the user can verify. Every sandbox
 * failure becomes a tool failure carrying its code, so the research run continues.
 */
export const RunJsTool = defineTool<RunJsToolDeps, ScriptArguments, RunJsOutput>({
  name: RUN_JS_TOOL,
  description:
    "Run a short synchronous JavaScript calculation in an isolated sandbox and return its " +
    "JSON result. Pass source figures in `inputs` and read them as the frozen global " +
    "`inputs`; the value of the last expression is the result, e.g. " +
    "`({ change: (inputs.b - inputs.a) / inputs.a * 100 })`. Only standard ECMAScript " +
    "built-ins and console.log exist: no network, files, timers, Promises or imports. " +
    "Runs stop after about 1 second.",
  schema: {
    code: text({
      required: true,
      maxLength: SCRIPT_ARGUMENT_LIMITS.codeChars,
      description: "Synchronous JavaScript; its last expression is the JSON result.",
    }),
    inputs: raw({
      type: "object",
      description:
        "Source figures the code reads as `inputs`, copied exactly from tool results " +
        "(JSON only).",
    }),
    purpose: str(SCRIPT_ARGUMENT_LIMITS.purposeChars, {
      description: "Short description of what is calculated, shown to the user.",
    }),
  },
  parse: (input): ToolParseResult<ScriptArguments> => {
    const validation = validateScriptArguments(input);
    if (!validation.ok) return toolFailure("invalid_arguments", validation.message);
    return { ok: true, value: validation.value };
  },
  execute: async (deps, input, context) => {
    let outcome;
    try {
      outcome = await deps.runner.run({
        code: input.code,
        inputs: input.inputs,
        limits: deps.limits ?? DEFAULT_SCRIPT_LIMITS,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolFailure("runtime", `The script sandbox failed: ${message}`);
    }
    if (!outcome.ok) {
      return toolFailure(
        outcome.code,
        outcome.message,
        false,
        outcome.logs.length > 0 ? { logs: outcome.logs } : undefined,
      );
    }
    const computationId = deps.recorder.registerComputation({
      callId: context.callId,
      ...(input.purpose ? { purpose: input.purpose } : {}),
      code: input.code,
      inputs: input.inputs,
      result: outcome.result,
      logs: outcome.logs,
    });
    return {
      ok: true,
      value: { computationId, result: outcome.result, logs: outcome.logs },
    };
  },
});
