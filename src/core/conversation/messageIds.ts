let messageSequence = 0;

/** Generates a process-unique identifier for a chat message. */
export function createMessageId(): string {
  messageSequence += 1;
  return `message-${Date.now().toString(36)}-${messageSequence.toString(36)}`;
}
