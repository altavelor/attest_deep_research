import { isIxplorerError } from "../../../core/errors";
import { ModelRoundProvider, ModelRoundRequest, ModelRoundResult } from "../../../core/agent/protocol";

export class FallbackModelRoundProvider implements ModelRoundProvider {
  constructor(
    private readonly primary: ModelRoundProvider,
    private readonly fallback: ModelRoundProvider,
  ) { }

  listModels(): Promise<string[]> {
    return this.primary.listModels();
  }

  async runRound(request: ModelRoundRequest): Promise<ModelRoundResult> {
    let outputObserved = false;
    try {
      return await this.primary.runRound({
        ...request,
        onEvent: (event) => {
          outputObserved = true;
          request.onEvent?.(event);
        },
        onDelta: (delta) => {
          outputObserved = true;
          request.onDelta?.(delta);
        },
      });
    } catch (error) {
      if (
        outputObserved ||
        request.continuation ||
        request.toolOutputs?.length ||
        !isClassifiedUnsupported(error)
      ) {
        throw error;
      }
      return this.fallback.runRound({
        ...request,
        continuation: undefined,
        toolOutputs: undefined,
      });
    }
  }
}

function isClassifiedUnsupported(error: unknown): boolean {
  if (!isIxplorerError(error)) return false;
  if (error.code === "UNSUPPORTED_CAPABILITY") return true;
  const providerCode = String(error.details?.providerCode ?? "").toLowerCase();
  const providerMessage = String(error.details?.providerMessage ?? "").toLowerCase();
  return (
    providerCode === "unsupported_parameter" ||
    /(?:unsupported|unknown) (?:endpoint|parameter|field).*(?:response|reasoning)/.test(
      providerMessage,
    )
  );
}
