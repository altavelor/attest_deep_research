import { newQuickJSWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import type { QuickJSContext, QuickJSHandle, QuickJSWASMModule } from "quickjs-emscripten-core";
import quickJsVariant from "@jitl/quickjs-singlefile-browser-release-sync";
import type {
  ScriptFailureCode,
  ScriptJsonValue,
  ScriptRunner,
  ScriptRunRequest,
  ScriptRunResult,
} from "@application/ports";
import { classifyScriptError, PRELUDE_SOURCE, type SerializedOutcome } from "./quickJsPrelude";

export interface QuickJsScriptRunnerOptions {
  loadModule?: (memory: WebAssembly.Memory) => Promise<QuickJSWASMModule>;
  now?: () => number;
}

const WASM_PAGE_BYTES = 64 * 1024;
const BASE_MEMORY_PAGES = 256;
const MAX_STACK_BYTES = 512 * 1024;

/** Instantiates the embedded QuickJS WebAssembly module over the given linear memory. */
function loadModuleWithMemory(memory: WebAssembly.Memory): Promise<QuickJSWASMModule> {
  return newQuickJSWASMModuleFromVariant(newVariant(quickJsVariant, { wasmMemory: memory }));
}

/**
 * Runs each script in a fresh QuickJS WebAssembly instance, so the script cannot reach
 * the network, the DOM, the vault or Obsidian, and no state survives between runs.
 * Time is bounded by the interrupt handler and memory by the instance's maximum
 * linear-memory size, because the QuickJS allocator limit does not count every byte.
 */
export class QuickJsScriptRunner implements ScriptRunner {
  private readonly loadModule: (memory: WebAssembly.Memory) => Promise<QuickJSWASMModule>;
  private readonly now: () => number;

  constructor(options: QuickJsScriptRunnerOptions = {}) {
    this.loadModule = options.loadModule ?? loadModuleWithMemory;
    this.now = options.now ?? (() => Date.now());
  }

  async run(request: ScriptRunRequest): Promise<ScriptRunResult> {
    let module: QuickJSWASMModule;
    try {
      const scriptPages = Math.ceil(request.limits.memoryBytes / WASM_PAGE_BYTES);
      module = await this.loadModule(
        new WebAssembly.Memory({
          initial: BASE_MEMORY_PAGES,
          maximum: BASE_MEMORY_PAGES + scriptPages,
        }),
      );
    } catch (error) {
      return failure("runtime", `The script sandbox could not start: ${errorText(error)}`, []);
    }
    return this.runInModule(module, request);
  }

  private runInModule(module: QuickJSWASMModule, request: ScriptRunRequest): ScriptRunResult {
    const { limits } = request;
    const logs: string[] = [];
    const state = { outputChars: 0, outputExceeded: false, timedOut: false };
    const deadline = this.now() + limits.timeoutMs;
    const runtime = module.newRuntime();
    runtime.setMemoryLimit(limits.memoryBytes);
    runtime.setMaxStackSize(MAX_STACK_BYTES);
    runtime.setInterruptHandler(() => {
      if (this.now() <= deadline) return false;
      state.timedOut = true;
      return true;
    });
    const context = runtime.newContext();
    const handles: QuickJSHandle[] = [];
    try {
      const emit = context.newFunction("emit", (line) => {
        const text = context.getString(line);
        state.outputChars += text.length;
        if (state.outputChars > limits.maxOutputChars) {
          state.outputExceeded = true;
          throw new Error("console output limit exceeded");
        }
        logs.push(text);
      });
      handles.push(emit);
      const serialize = this.installPrelude(context, handles, JSON.stringify(request.inputs), emit);
      if (!serialize.ok) return this.mapError(context, serialize.error, state, logs);

      const evaluated = context.evalCode(request.code, "script.js", { type: "global" });
      if (evaluated.error) {
        handles.push(evaluated.error);
        return this.mapError(context, evaluated.error, state, logs);
      }
      handles.push(evaluated.value);
      const serialized = context.callFunction(serialize.value, context.undefined, evaluated.value);
      if (serialized.error) {
        handles.push(serialized.error);
        return this.mapError(context, serialized.error, state, logs);
      }
      handles.push(serialized.value);
      return this.mapOutcome(
        context.dump(serialized.value) as SerializedOutcome,
        state,
        logs,
        limits,
      );
    } catch (error) {
      return failure(
        state.timedOut ? "timeout" : classifyHostError(error),
        `The script sandbox failed: ${errorText(error)}`,
        logs,
      );
    } finally {
      for (const handle of handles.reverse()) {
        if (handle.alive) handle.dispose();
      }
      context.dispose();
      runtime.dispose();
    }
  }

  private installPrelude(
    context: QuickJSContext,
    handles: QuickJSHandle[],
    inputsJson: string,
    emit: QuickJSHandle,
  ): { ok: true; value: QuickJSHandle } | { ok: false; error: QuickJSHandle } {
    const prelude = context.evalCode(PRELUDE_SOURCE, "prelude.js", { type: "global" });
    if (prelude.error) {
      handles.push(prelude.error);
      return { ok: false, error: prelude.error };
    }
    handles.push(prelude.value);
    const inputs = context.newString(inputsJson);
    handles.push(inputs);
    const installed = context.callFunction(prelude.value, context.undefined, inputs, emit);
    if (installed.error) {
      handles.push(installed.error);
      return { ok: false, error: installed.error };
    }
    handles.push(installed.value);
    return { ok: true, value: installed.value };
  }

  private mapError(
    context: QuickJSContext,
    error: QuickJSHandle,
    state: { outputExceeded: boolean; timedOut: boolean },
    logs: string[],
  ): ScriptRunResult {
    if (state.timedOut) return failure("timeout", "The script exceeded its time limit.", logs);
    if (state.outputExceeded) {
      return failure("output_too_large", "The script printed more output than allowed.", logs);
    }
    const classified = classifyScriptError(safeDump(context, error));
    return failure(classified.code, classified.message, logs);
  }

  private mapOutcome(
    outcome: SerializedOutcome,
    state: { outputChars: number },
    logs: string[],
    limits: ScriptRunRequest["limits"],
  ): ScriptRunResult {
    switch (outcome.kind) {
      case "json": {
        if (state.outputChars + outcome.text.length > limits.maxOutputChars) {
          return failure("output_too_large", "The script result is larger than allowed.", logs);
        }
        return { ok: true, result: JSON.parse(outcome.text) as ScriptJsonValue, logs };
      }
      case "promise":
        return failure(
          "non_serializable_result",
          "The script returned a Promise; async code is not supported.",
          logs,
        );
      case "undefined":
        return failure(
          "non_serializable_result",
          "The script produced no JSON value; end it with an expression such as ({ total }).",
          logs,
        );
      case "non-finite":
        return failure(
          "non_serializable_result",
          "The script result contains NaN or Infinity, which JSON cannot represent.",
          logs,
        );
      case "error":
        return failure(
          "non_serializable_result",
          `The script result is not JSON-serializable: ${outcome.message}`,
          logs,
        );
    }
  }
}

function safeDump(context: QuickJSContext, handle: QuickJSHandle): unknown {
  try {
    return context.dump(handle);
  } catch {
    return undefined;
  }
}

function classifyHostError(error: unknown): ScriptFailureCode {
  return /out of memory/i.test(errorText(error)) ? "memory" : "runtime";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(code: ScriptFailureCode, message: string, logs: string[]): ScriptRunResult {
  return { ok: false, code, message, logs };
}
