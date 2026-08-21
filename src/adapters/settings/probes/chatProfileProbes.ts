export interface ChatProfileProbeTasks<TTools, TResponses, TReasoning = never> {
  probeTools?: () => Promise<TTools>;
  probeResponses?: () => Promise<TResponses>;
  probeReasoning?: () => Promise<TReasoning>;
  onTools(result: TTools): void | Promise<void>;
  onResponses(result: TResponses): void | Promise<void>;
  onReasoning?: (result: TReasoning) => void | Promise<void>;
  onToolsError?(error: unknown): void;
  onResponsesError?(error: unknown): void;
  onReasoningError?(error: unknown): void;
  onError?(error: unknown): void;
}

export function startChatProfileProbes<TTools, TResponses, TReasoning = never>(
  tasks: ChatProfileProbeTasks<TTools, TResponses, TReasoning>,
): void {
  startProbe(tasks.probeTools, tasks.onTools, tasks.onToolsError ?? tasks.onError);
  startProbe(tasks.probeResponses, tasks.onResponses, tasks.onResponsesError ?? tasks.onError);
  if (tasks.onReasoning)
    startProbe(tasks.probeReasoning, tasks.onReasoning, tasks.onReasoningError ?? tasks.onError);
}

function startProbe<TResult>(
  probe: (() => Promise<TResult>) | undefined,
  publish: (result: TResult) => void | Promise<void>,
  onError: ((error: unknown) => void) | undefined,
): void {
  if (!probe) return;
  void probe()
    .then(publish)
    .catch(onError ?? (() => undefined));
}
