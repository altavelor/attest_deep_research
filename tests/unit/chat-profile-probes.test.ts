import { startChatProfileProbes } from "../../src/adapters/settings/chatProfileProbes";

describe("chat profile probes", () => {
  it("starts tool and Responses probes concurrently and publishes results independently", async () => {
    let resolveTools!: (value: { calls: boolean }) => void;
    let resolveResponses!: (value: { responses: boolean }) => void;
    const tools = new Promise<{ calls: boolean }>((resolve) => (resolveTools = resolve));
    const responses = new Promise<{ responses: boolean }>(
      (resolve) => (resolveResponses = resolve),
    );
    const published: string[] = [];

    startChatProfileProbes({
      probeTools: () => tools,
      probeResponses: () => responses,
      onTools: () => {
        published.push("tools");
      },
      onResponses: () => {
        published.push("responses");
      },
    });

    expect(published).toEqual([]);
    resolveTools({ calls: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(published).toEqual(["tools"]);

    resolveResponses({ responses: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(published).toEqual(["tools", "responses"]);
  });
});
