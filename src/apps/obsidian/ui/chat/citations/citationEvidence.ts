import { AnswerWebReference, isWebReferenceId } from "@core/answer";
import { ChatDisplayMessage } from "@core/conversation";
import { RetrievedChunk } from "@core/model";

/**
 * The sources a message's answer refers to, in the order they are numbered:
 * cited evidence first, then the web pages the answer cited without gathering
 * evidence, which carry a link but no text.
 */
export function citationEvidence(message: ChatDisplayMessage): RetrievedChunk[] {
  const evidence = message.evidence ?? [];
  const citations = message.answer?.citations;
  const citedIds = citations ? new Set(citations.map((citation) => citation.id)) : undefined;
  const cited = citedIds ? evidence.filter((chunk) => citedIds.has(chunk.id)) : evidence;
  return [...cited, ...(message.answer?.webReferences ?? []).map(webReferenceChunk)];
}

/** True for a source that is only a link: it has no retrieved text to show. */
export function isLinkOnlyChunk(chunk: RetrievedChunk): boolean {
  return isWebReferenceId(chunk.id);
}

function webReferenceChunk(reference: AnswerWebReference): RetrievedChunk {
  return {
    id: reference.id,
    text: "",
    score: 0,
    contentHash: reference.id,
    source: {
      id: reference.id,
      kind: "web",
      title: reference.url,
      url: reference.url,
      snippet: "",
      retrievedAt: "",
      wasContentFetched: false,
    },
  };
}
