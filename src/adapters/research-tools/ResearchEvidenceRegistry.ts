import { randomUUID } from "crypto";

import { stableId } from "@adapters/extractors/common";
import { formatCitation } from "@core/retrieval";
import { Citation } from "@core/model";
import { RetrievedChunk, SourceReference, WebSourceReference } from "@core/model";
import {
  EvidenceCallProvenance,
  EvidenceRegistry,
  RegisteredWebResult,
  ResearchEvidenceSnapshot,
  WebHandleEntry,
} from "@application/sources";
import { validatePublicWebUrl } from "@application/sources";

interface MutableEvidenceEntry {
  chunk: RetrievedChunk;
  citation: Citation;
  calls: EvidenceCallProvenance[];
  page?: { finalUrl: string; truncated: boolean };
}

export interface ResearchEvidenceRegistryOptions {
  createHandle?: () => string;
  now?: () => Date;
  maxWebResults?: number;
}

const DEFAULT_MAX_WEB_RESULTS = 25;

export class ResearchEvidenceRegistry implements EvidenceRegistry {
  private readonly createHandle: () => string;
  private readonly now: () => Date;
  private readonly maxWebResults: number;
  private readonly entries = new Map<string, MutableEvidenceEntry>();
  private readonly handles = new Map<string, WebHandleEntry>();
  private readonly handlesByUrl = new Map<string, WebHandleEntry>();

  constructor(options: ResearchEvidenceRegistryOptions = {}) {
    this.createHandle = options.createHandle ?? (() => `result_${randomUUID()}`);
    this.now = options.now ?? (() => new Date());
    this.maxWebResults = options.maxWebResults ?? DEFAULT_MAX_WEB_RESULTS;
  }

  registerIndexChunk(chunk: RetrievedChunk, provenance: { callId: string; query: string }): string {
    const evidenceId = chunk.id;
    const existing = this.entries.get(evidenceId);
    const call: EvidenceCallProvenance = {
      callId: provenance.callId,
      query: provenance.query,
      tool: "search_index",
    };

    if (existing) {
      appendCall(existing.calls, call);
      return evidenceId;
    }

    const registeredChunk = cloneChunk({ ...chunk, id: evidenceId });
    this.entries.set(evidenceId, {
      chunk: registeredChunk,
      citation: { ...formatCitation(registeredChunk.source), id: evidenceId },
      calls: [call],
    });
    return evidenceId;
  }

  registerNoteEvidence(
    input: { evidenceId: string; source: SourceReference; content: string },
    provenance: { callId: string; tool: "read_note" | "get_active_note" },
  ): string {
    const existing = this.entries.get(input.evidenceId);
    const call: EvidenceCallProvenance = { callId: provenance.callId, tool: provenance.tool };
    if (existing) {
      appendCall(existing.calls, call);
      return input.evidenceId;
    }
    const chunk: RetrievedChunk = {
      id: input.evidenceId,
      source: cloneValue(input.source),
      text: input.content,
      contentHash: stableId(input.content),
      score: 1,
    };
    this.entries.set(input.evidenceId, {
      chunk,
      citation: { ...formatCitation(chunk.source), id: chunk.id },
      calls: [call],
    });
    return input.evidenceId;
  }

  registerWebResult(
    result: { url: string; title: string; snippet: string; rank: number },
    provenance: { callId: string; query: string },
  ): RegisteredWebResult {
    const canonicalUrl = canonicalizeWebUrl(result.url);
    const existingHandle = this.handlesByUrl.get(canonicalUrl);
    const call: EvidenceCallProvenance = {
      callId: provenance.callId,
      query: provenance.query,
      tool: "search_web",
    };

    if (existingHandle) {
      const entry = this.entries.get(existingHandle.evidenceId);
      if (entry) {
        appendCall(entry.calls, call);
      }
      return publicWebResult(existingHandle);
    }

    if (this.handles.size >= this.maxWebResults) {
      throw new Error("Web result registry capacity exceeded.");
    }

    const evidenceId = `web:${stableId(canonicalUrl)}`;
    const resultId = this.uniqueHandle();
    const source: WebSourceReference = {
      id: evidenceId,
      kind: "web",
      title: result.title,
      url: canonicalUrl,
      snippet: result.snippet,
      retrievedAt: this.now().toISOString(),
      wasContentFetched: false,
    };
    const chunk: RetrievedChunk = {
      id: evidenceId,
      source,
      text: result.snippet,
      contentHash: stableId(result.snippet),
      score: 1 / Math.max(1, result.rank),
    };
    const handle: WebHandleEntry = { resultId, evidenceId, canonicalUrl, source };

    this.entries.set(evidenceId, {
      chunk,
      citation: { ...formatCitation(source), id: evidenceId },
      calls: [call],
    });
    this.handles.set(resultId, handle);
    this.handlesByUrl.set(canonicalUrl, handle);
    return publicWebResult(handle);
  }

  resolveWebResult(resultId: string): Readonly<WebHandleEntry> | undefined {
    const entry = this.handles.get(resultId);
    return entry ? deepFreeze(cloneValue(entry)) : undefined;
  }

  upgradeWebPage(
    resultId: string,
    page: { content: string; finalUrl: string; truncated: boolean; callId: string },
  ): void {
    const handle = this.handles.get(resultId);
    if (!handle) {
      throw new Error("Unknown web result handle.");
    }
    const entry = this.entries.get(handle.evidenceId);
    if (!entry || entry.chunk.source.kind !== "web") {
      throw new Error("Registered web evidence is unavailable.");
    }

    const source: WebSourceReference = {
      ...entry.chunk.source,
      wasContentFetched: true,
    };
    entry.chunk = {
      ...entry.chunk,
      source,
      text: page.content,
      contentHash: stableId(page.content),
    };
    entry.citation = { ...formatCitation(source), id: handle.evidenceId };
    entry.page = { finalUrl: page.finalUrl, truncated: page.truncated };
    appendCall(entry.calls, { callId: page.callId, tool: "fetch_web_page" });
  }

  snapshot(): ResearchEvidenceSnapshot {
    const snapshot: ResearchEvidenceSnapshot = {
      evidence: Array.from(this.entries.values(), (entry) => cloneChunk(entry.chunk)),
      citations: Array.from(this.entries.values(), (entry) => cloneValue(entry.citation)),
      provenance: Array.from(this.entries.entries(), ([evidenceId, entry]) => ({
        evidenceId,
        calls: entry.calls.map((call) => ({ ...call })),
        ...(entry.page ? { page: { ...entry.page } } : {}),
      })),
    };
    return deepFreeze(snapshot);
  }

  private uniqueHandle(): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const handle = this.createHandle();
      if (handle && !this.handles.has(handle)) {
        return handle;
      }
    }
    throw new Error("Could not allocate a unique web result handle.");
  }
}

export function canonicalizeWebUrl(value: string): string {
  const validated = validatePublicWebUrl(value);
  if (!validated.ok) {
    throw new Error(`Unsafe web URL: ${validated.reason}.`);
  }
  return validated.url;
}

function publicWebResult(entry: WebHandleEntry): RegisteredWebResult {
  return {
    resultId: entry.resultId,
    evidenceId: entry.evidenceId,
    canonicalUrl: entry.canonicalUrl,
  };
}

function appendCall(calls: EvidenceCallProvenance[], call: EvidenceCallProvenance): void {
  if (
    !calls.some((candidate) => candidate.callId === call.callId && candidate.tool === call.tool)
  ) {
    calls.push(call);
  }
}

function cloneChunk(chunk: RetrievedChunk): RetrievedChunk {
  return cloneValue(chunk);
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}
