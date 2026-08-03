import { ChatDisplayMessage } from "@core/conversation";
import { RetrievedChunk } from "@core/model";

export function citationEvidence(message: ChatDisplayMessage): RetrievedChunk[] {
  const evidence = message.evidence ?? [];
  const citations = message.answer?.citations;
  if (!citations) {
    return evidence;
  }
  const citedIds = new Set(citations.map((citation) => citation.id));
  return evidence.filter((chunk) => citedIds.has(chunk.id));
}
