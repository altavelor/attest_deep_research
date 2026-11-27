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
  WebResultCapacityError,
} from "@application/sources";
import { validatePublicWebUrl } from "@application/sources";
import { MAX_PAGE_EVIDENCE_CHARS } from "@core/web";

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
const PASSAGE_SEPARATOR_CHARS = 40;

interface PagePart {
  offset: number;
  text: string;
  seq: number;
}

interface PageParts {
  head: string;
  passages: PagePart[];
  seq: number;
}

/**
 * Registers the evidence of one answer under stable IDs and bounded web handles. A fifth of the
 * web handles is kept for pages fetched by URL, so search results cannot use up every handle.
 */
export class ResearchEvidenceRegistry implements EvidenceRegistry {
  private readonly createHandle: () => string;
  private readonly now: () => Date;
  private readonly maxWebResults: number;
  private readonly entries = new Map<string, MutableEvidenceEntry>();
  private readonly handles = new Map<string, WebHandleEntry>();
  private readonly handlesByUrl = new Map<string, WebHandleEntry>();
  private readonly pages = new Map<string, PageParts>();

  constructor(options: ResearchEvidenceRegistryOptions = {}) {
    this.createHandle = options.createHandle ?? (() => `result_${crypto.randomUUID()}`);
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
    provenance: { callId: string; query: string; fetch?: boolean },
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

    const limit = provenance.fetch
      ? this.maxWebResults
      : this.maxWebResults - Math.floor(this.maxWebResults / 5);
    if (this.handles.size >= limit) {
      throw new WebResultCapacityError(this.maxWebResults);
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
    this.pages.set(handle.evidenceId, { head: page.content, passages: [], seq: 0 });
  }

  addWebPassages(
    resultId: string,
    passages: readonly { offset: number; text: string }[],
    callId: string,
  ): void {
    const handle = this.handles.get(resultId);
    const entry = handle ? this.entries.get(handle.evidenceId) : undefined;
    const parts = handle ? this.pages.get(handle.evidenceId) : undefined;
    if (!handle || !entry || !parts) {
      throw new Error("Registered web page is unavailable.");
    }
    parts.seq += 1;
    for (const passage of passages) {
      if (passage.text.length > 0) {
        parts.passages.push({ offset: passage.offset, text: passage.text, seq: parts.seq });
      }
    }
    const { text, kept } = composePageEvidence(parts);
    parts.passages = kept;
    entry.chunk = { ...entry.chunk, text, contentHash: stableId(text) };
    appendCall(entry.calls, { callId, tool: "fetch_web_page" });
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

  /**
   * Adds evidence that a resolver already registered in the conversation, under its own
   * alias IDs. Existing entries and web handles stay unchanged and the web capacity is
   * not charged, because the import was admitted and stored before.
   */
  remainingWebCapacity(): number {
    return Math.max(0, this.maxWebResults - this.handles.size);
  }

  importRegisteredSnapshot(snapshot: ResearchEvidenceSnapshot): void {
    for (const chunk of snapshot.evidence) {
      if (this.entries.has(chunk.id)) continue;
      const citation = snapshot.citations.find((entry) => entry.id === chunk.id);
      const provenance = snapshot.provenance.find((entry) => entry.evidenceId === chunk.id);
      this.entries.set(chunk.id, {
        chunk: cloneChunk(chunk),
        citation: citation
          ? cloneValue(citation)
          : { ...formatCitation(chunk.source), id: chunk.id },
        calls: (provenance?.calls ?? []).map((call) => ({ ...call })),
        ...(provenance?.page ? { page: { ...provenance.page } } : {}),
      });
    }
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

/**
 * Builds the evidence text of a page from its head and the passages returned to the model: the
 * newest passages first until the evidence cap, merged where they overlap, in reading order.
 */
function composePageEvidence(parts: PageParts): { text: string; kept: PagePart[] } {
  const budget = MAX_PAGE_EVIDENCE_CHARS - parts.head.length;
  const newest = [...parts.passages]
    .map((part) => trimToTail(part, parts.head.length))
    .filter((part): part is PagePart => part !== null)
    .sort((a, b) => b.seq - a.seq);
  let chosen: PagePart[] = [];
  for (const part of newest) {
    const next = mergeParts([...chosen, part]);
    if (partsSize(next) <= budget) chosen = next;
    else if (chosen.length === 0)
      chosen = [
        { ...part, text: part.text.slice(0, Math.max(0, budget - PASSAGE_SEPARATOR_CHARS)) },
      ];
  }
  const kept = mergeParts(chosen);
  return {
    text: [parts.head, ...kept.map((part) => `[… offset ${part.offset} …]\n${part.text}`)].join(
      "\n\n",
    ),
    kept,
  };
}

function trimToTail(part: PagePart, headChars: number): PagePart | null {
  const end = part.offset + part.text.length;
  if (end <= headChars) return null;
  return part.offset >= headChars
    ? part
    : { ...part, offset: headChars, text: part.text.slice(headChars - part.offset) };
}

function mergeParts(parts: readonly PagePart[]): PagePart[] {
  const merged: PagePart[] = [];
  for (const part of [...parts].sort((a, b) => a.offset - b.offset)) {
    const last = merged.at(-1);
    if (last && part.offset <= last.offset + last.text.length) {
      const overlap = last.offset + last.text.length - part.offset;
      merged[merged.length - 1] = {
        ...last,
        text: last.text + part.text.slice(overlap),
        seq: Math.max(last.seq, part.seq),
      };
    } else {
      merged.push({ ...part });
    }
  }
  return merged;
}

function partsSize(parts: readonly PagePart[]): number {
  return parts.reduce((total, part) => total + part.text.length + PASSAGE_SEPARATOR_CHARS, 0);
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
