import { executeTool } from "@core/agent";
import { DEFAULT_SCRIPT_LIMITS, type ScriptRunner } from "@application/ports";
import { SCRIPT_ARGUMENT_LIMITS } from "@application/research";
import { ResearchEvidenceRegistry } from "@adapters/research-tools/ResearchEvidenceRegistry";
import { RunJsTool } from "@adapters/research-tools/script/RunJsTool";

function setup(run: ScriptRunner["run"]) {
  const runner = { run: vi.fn(run) };
  const recorder = new ResearchEvidenceRegistry();
  const tool = new RunJsTool({ runner, recorder });
  const call = (args: Record<string, unknown>) =>
    executeTool(tool, { id: "call-7", name: "run_js", arguments: args });
  return { runner, recorder, call };
}

describe("run_js tool", () => {
  it("records a successful run as a computation and returns its result", async () => {
    const { runner, recorder, call } = setup(async () => ({
      ok: true,
      result: { change: 15 },
      logs: ["rows"],
    }));

    const execution = await call({
      code: "({ change: (inputs.b - inputs.a) / inputs.a * 100 })",
      inputs: { a: 80, b: 92 },
      purpose: "  Revenue change  ",
    });

    expect(execution).toEqual({
      ok: true,
      value: { computationId: "calc_1", result: { change: 15 }, logs: ["rows"] },
    });
    expect(runner.run).toHaveBeenCalledWith({
      code: "({ change: (inputs.b - inputs.a) / inputs.a * 100 })",
      inputs: { a: 80, b: 92 },
      limits: DEFAULT_SCRIPT_LIMITS,
    });
    expect(recorder.computations()).toEqual([
      {
        computationId: "calc_1",
        callId: "call-7",
        purpose: "Revenue change",
        code: "({ change: (inputs.b - inputs.a) / inputs.a * 100 })",
        inputs: { a: 80, b: 92 },
        result: { change: 15 },
        logs: ["rows"],
      },
    ]);
  });

  it("passes null inputs when the model omits them", async () => {
    const { runner, call } = setup(async () => ({ ok: true, result: 2, logs: [] }));

    await call({ code: "1 + 1" });

    expect(runner.run.mock.calls[0]?.[0].inputs).toBeNull();
  });

  it.each([
    [{ code: "   " }, "code must be a non-empty string."],
    [{ code: 42 }, "code must be a non-empty string."],
    [
      { code: "x".repeat(SCRIPT_ARGUMENT_LIMITS.codeChars + 1) },
      `code is longer than ${SCRIPT_ARGUMENT_LIMITS.codeChars} characters.`,
    ],
    [{ code: "1", script: "2" }, 'run_js does not accept "script".'],
    [{ code: "1", inputs: { a: Number.NaN } }, "inputs must not contain NaN or Infinity."],
    [{ code: "1", inputs: { when: new Date(0) } }, "inputs must contain only JSON values."],
    [{ code: "1", inputs: () => 1 }, "inputs must contain only JSON values."],
    [
      { code: "1", inputs: nested(SCRIPT_ARGUMENT_LIMITS.inputsDepth + 1) },
      `inputs are nested deeper than ${SCRIPT_ARGUMENT_LIMITS.inputsDepth} levels.`,
    ],
    [
      { code: "1", inputs: ["x".repeat(SCRIPT_ARGUMENT_LIMITS.inputsChars)] },
      `inputs are larger than ${SCRIPT_ARGUMENT_LIMITS.inputsChars} characters of JSON.`,
    ],
    [{ code: "1", purpose: 3 }, "purpose must be a string."],
  ])("rejects %j as invalid arguments", async (args, message) => {
    const { runner, call } = setup(async () => ({ ok: true, result: null, logs: [] }));

    const execution = await call(args);

    expect(execution).toEqual({
      ok: false,
      error: { code: "invalid_arguments", message, retryable: false },
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("accepts inputs at the depth limit", async () => {
    const { call } = setup(async () => ({ ok: true, result: null, logs: [] }));

    const execution = await call({
      code: "1",
      inputs: nested(SCRIPT_ARGUMENT_LIMITS.inputsDepth),
    });

    expect(execution.ok).toBe(true);
  });

  it("returns a sandbox failure as a tool failure with its logs and records nothing", async () => {
    const { recorder, call } = setup(async () => ({
      ok: false,
      code: "timeout",
      message: "The script exceeded its time limit.",
      logs: ["start"],
    }));

    const execution = await call({ code: "while (true) {}" });

    expect(execution).toEqual({
      ok: false,
      error: {
        code: "timeout",
        message: "The script exceeded its time limit.",
        retryable: false,
        details: { logs: ["start"] },
      },
    });
    expect(recorder.computations()).toEqual([]);
  });

  it("omits empty logs from a failure", async () => {
    const { call } = setup(async () => ({
      ok: false,
      code: "syntax",
      message: "SyntaxError: unexpected token",
      logs: [],
    }));

    const execution = await call({ code: "const = 1" });

    expect(execution.ok ? undefined : execution.error.details).toBeUndefined();
  });

  it("reports a throwing runner as a runtime failure", async () => {
    const { call } = setup(async () => {
      throw new Error("wasm unavailable");
    });

    const execution = await call({ code: "1" });

    expect(execution.ok ? undefined : execution.error).toEqual({
      code: "runtime",
      message: "The script sandbox failed: wasm unavailable",
      retryable: false,
    });
  });
});

function nested(depth: number): unknown {
  let value: unknown = 1;
  for (let level = 0; level < depth; level += 1) value = [value];
  return value;
}
