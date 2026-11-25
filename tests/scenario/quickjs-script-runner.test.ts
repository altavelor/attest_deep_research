import { describe, expect, it } from "vitest";

import { QuickJsScriptRunner } from "@adapters/sandbox";
import { DEFAULT_SCRIPT_LIMITS, type ScriptLimits } from "@application/ports";

const runner = new QuickJsScriptRunner();

function run(code: string, inputs: unknown = null, limits: Partial<ScriptLimits> = {}) {
  return runner.run({
    code,
    inputs: inputs as never,
    limits: { ...DEFAULT_SCRIPT_LIMITS, timeoutMs: 100, ...limits },
  });
}

describe("QuickJS script runner", () => {
  it("computes from the inputs and captures console output", async () => {
    const result = await run(
      "const [before, after] = inputs.rows; console.log('rows', inputs.rows, 2); " +
        "({ change: ((after - before) / before) * 100 })",
      { rows: [80, 92] },
    );

    expect(result).toEqual({ ok: true, result: { change: 15 }, logs: ["rows [80,92] 2"] });
  });

  it("interrupts an infinite loop at the time limit", async () => {
    const result = await run("console.log('start'); while (true) {}", null, { timeoutMs: 30 });

    expect(result).toEqual({
      ok: false,
      code: "timeout",
      message: "The script exceeded its time limit.",
      logs: ["start"],
    });
  });

  it("exposes no network, host or module globals", async () => {
    const result = await run(
      "['fetch','XMLHttpRequest','require','process','window','document','app','WebSocket','importScripts']" +
        ".filter((name) => typeof globalThis[name] !== 'undefined')",
    );

    expect(result).toEqual({ ok: true, result: [], logs: [] });
  });

  it.each([
    ["syntax", "const = 1;", {}],
    ["runtime", "inputs.rows.push(1); inputs", { inputs: { rows: [1] } }],
    ["runtime", "throw 'plain failure'", {}],
    ["syntax", "import x from 'y'; x", {}],
    [
      "memory",
      "const parts = []; while (true) parts.push('x'.repeat(4096));",
      { memoryBytes: 2 ** 20 },
    ],
    [
      "output_too_large",
      "for (let i = 0; i < 100; i += 1) console.log('0123456789');",
      { maxOutputChars: 200 },
    ],
    ["output_too_large", "'x'.repeat(300)", { maxOutputChars: 200 }],
    ["non_serializable_result", "(async () => 1)()", {}],
    ["non_serializable_result", "let unset; unset", {}],
    ["non_serializable_result", "({ ratio: 1 / 0 })", {}],
    ["non_serializable_result", "const loop = {}; loop.self = loop; loop", {}],
  ] as const)("reports %s for %s", async (code, script, options) => {
    const { inputs = null, ...limits } = options as Partial<ScriptLimits> & { inputs?: unknown };
    const result = await run(script, inputs, limits);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.code).toBe(code);
  });
});
