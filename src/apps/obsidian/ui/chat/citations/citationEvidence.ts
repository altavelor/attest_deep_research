import { ChatDisplayMessage } from "@core/conversation";
import { RetrievedChunk } from "@core/model";

// Evidence to surface as a message's source list. Once the answer is finalized,
// its citation list is already narrowed upstream to the sources the answer actually
// cites, so show only those — the source list must never enumerate more links than
// the answer text mentions. While still streaming (no finalized answer yet), show
// all consulted evidence.
export function citationEvidence(message: ChatDisplayMessage): RetrievedChunk[] {
  const evidence = message.evidence ?? [];
  const citations = message.answer?.citations;
  if (!citations) {
    return evidence;
  }
  const citedIds = new Set(citations.map((citation) => citation.id));
  return evidence.filter((chunk) => citedIds.has(chunk.id));
}
