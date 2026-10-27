let messageSequence = 0;

/** Generates a process-unique identifier for a chat message. */
export function createMessageId(): string {
  messageSequence += 1;
  return `message-${Date.now().toString(36)}-${messageSequence.toString(36)}`;
}

/** Names the assistant message of a parent research run, so its sub-agent events can find it. */
export function answerMessageId(runId: string): string {
  return `answer-${runId}`;
}
