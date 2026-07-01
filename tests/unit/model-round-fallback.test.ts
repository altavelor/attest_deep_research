import { FallbackModelRoundProvider } from "@adapters/model-provider";
import { IxplorerError } from "@core/errors";
import { ModelRoundProvider } from "@core/agent";

function provider(runRound: ModelRoundProvider["runRound"]): ModelRoundProvider {
  return { listModels: async () => ["m"], runRound };
}

describe("FallbackModelRoundProvider", () => {
  it("falls back once for a classified unsupported request before output", async () => {
    const fallback = vi.fn().mockResolvedValue({
      items: [{ type: "text", text: "ok" }],
      stopReason: "complete",
    });
    const wrapper = new FallbackModelRoundProvider(
      provider(async () => {
        throw new IxplorerError({
          code: "UNSUPPORTED_CAPABILITY",
          message: "Responses is unsupported",
        });
      }),
      provider(fallback),
    );

    await expect(wrapper.runRound({ model: "m", messages: [] })).resolves.toMatchObject({
      stopReason: "complete",
    });
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("never falls back after any stream event", async () => {
    const fallback = vi.fn();
    const wrapper = new FallbackModelRoundProvider(
      provider(async (request) => {
        request.onEvent?.({ type: "text-delta", text: "partial" });
        throw new IxplorerError({
          code: "UNSUPPORTED_CAPABILITY",
          message: "late failure",
        });
      }),
      provider(fallback),
    );

    await expect(wrapper.runRound({ model: "m", messages: [] })).rejects.toMatchObject({
      code: "UNSUPPORTED_CAPABILITY",
    });
    expect(fallback).not.toHaveBeenCalled();
  });
});
