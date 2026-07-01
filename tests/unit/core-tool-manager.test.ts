import { Tool } from "@core/agent";
import { ToolManager } from "../../src/application/tools/ToolManager";

function makeTool(name: string): Tool<{ value: string }, { echoed: string }> {
  return {
    definition: {
      type: "function",
      function: { name, description: `echo ${name}`, parameters: {} },
    },
    parseInput(input) {
      if (typeof input.value !== "string") {
        return { ok: false, error: { code: "bad-input", message: "value required", retryable: false } };
      }
      return { ok: true, value: { value: input.value } };
    },
    async execute(input) {
      return { ok: true, value: { echoed: input.value } };
    },
  };
}

describe("core ToolManager", () => {
  it("registers a new tool and dispatches a call to it", async () => {
    const manager = new ToolManager();
    manager.register(makeTool("echo"));

    expect(manager.has("echo")).toBe(true);
    expect(manager.definitions().map((d) => d.function.name)).toEqual(["echo"]);

    const result = await manager.execute({ id: "1", name: "echo", arguments: { value: "hi" } });
    expect(result).toEqual({ ok: true, value: { echoed: "hi" } });
  });

  it("rejects duplicate tool names", () => {
    const manager = new ToolManager([makeTool("echo")]);
    expect(() => manager.register(makeTool("echo"))).toThrow(/Duplicate tool/);
  });

  it("returns a structured failure for unknown tools", async () => {
    const manager = new ToolManager();
    const result = await manager.execute({ id: "1", name: "missing", arguments: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unknown-tool");
    }
  });

  it("surfaces parse failures from the tool", async () => {
    const manager = new ToolManager([makeTool("echo")]);
    const result = await manager.execute({ id: "1", name: "echo", arguments: { value: 42 } });
    expect(result.ok).toBe(false);
  });
});
