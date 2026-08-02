import { Citation } from "@core/model";
import { RetrievedChunk, SourceReference, WebSourceReference } from "@core/model";

export interface EvidenceCallProvenance {
  callId: string;
  query?: string;
  tool: "search_index" | "search_web" | "fetch_web_page" | "read_note" | "get_active_note";
}

export interface EvidenceProvenance {
  evidenceId: string;
  calls: readonly EvidenceCallProvenance[];
  page?: { finalUrl: string; truncated: boolean };
}

export interface ResearchEvidenceSnapshot {
  evidence: readonly RetrievedChunk[];
  citations: readonly Citation[];
  provenance: readonly EvidenceProvenance[];
}

export interface RegisteredWebResult {
  resultId: string;
  evidenceId: string;
  canonicalUrl: string;
}

export interface WebHandleEntry extends RegisteredWebResult {
  source: WebSourceReference;
}

export interface EvidenceRegistry {
  registerIndexChunk(chunk: RetrievedChunk, provenance: { callId: string; query: string }): string;
  registerNoteEvidence(
    input: { evidenceId: string; source: SourceReference; content: string },
    provenance: { callId: string; tool: "read_note" | "get_active_note" },
  ): string;
  registerWebResult(
    result: { url: string; title: string; snippet: string; rank: number },
    provenance: { callId: string; query: string },
  ): RegisteredWebResult;
  resolveWebResult(resultId: string): Readonly<WebHandleEntry> | undefined;
  upgradeWebPage(
    resultId: string,
    page: { content: string; finalUrl: string; truncated: boolean; callId: string },
  ): void;
  snapshot(): ResearchEvidenceSnapshot;
}
