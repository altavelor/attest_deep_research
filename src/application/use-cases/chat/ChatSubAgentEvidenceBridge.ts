import type {
  SubAgentEvidenceImportPort,
  SubAgentImportedEvidenceResolver,
  SubAgentImportLookup,
  SubAgentImportRequest,
  SubAgentImportResult,
  SubAgentPreparedImport,
  SubAgentPreparedImportRequest,
} from "@application/ports/subAgent";
import type { ResearchEvidenceSnapshot } from "@application/sources/evidence";
import {
  registerConversationEvidence,
  type ConversationEvidenceRevision,
  type ConversationSource,
  type ConversationSourceRegistry,
} from "@core/chat/sourceRegistry";
import type { RetrievedChunk } from "@core/model";
import {
  readSubAgentImportItems,
  subAgentAliasPrefix,
  subAgentSessionError,
  SubAgentSessionFailure,
  type ImportedSubAgentEvidenceReference,
  type ImportedSubAgentRunOutcome,
  type SubAgentImportItem,
  type SubAgentRunSummary,
} from "@core/research";
import { formatCitation } from "@core/retrieval";

export interface ChatSubAgentEvidenceBridgeContext {
  lookup(): SubAgentImportLookup | null;
  serialize<T>(work: () => Promise<T>): Promise<T>;
  readRegistry(): ConversationSourceRegistry;
  writeRegistry(registry: ConversationSourceRegistry): void;
  saveRegistry(registry: ConversationSourceRegistry): Promise<void>;
}

interface LocatedChunk {
  source: ConversationSource;
  revision: ConversationEvidenceRevision;
  chunk: RetrievedChunk;
}

/**
 * Registers prepared child evidence in the chat's conversation source registry and
 * resolves committed imports back into checked evidence. Registration under the chat
 * serializer only adds aliases and never rolls them back; the identity of the import is
 * re-checked before and after every durable save, so a tombstone leaves only orphans.
 */
export class ChatSubAgentEvidenceBridge
  implements SubAgentEvidenceImportPort, SubAgentImportedEvidenceResolver
{
  constructor(private readonly context: ChatSubAgentEvidenceBridgeContext) {}

  commit(request: SubAgentImportRequest): Promise<SubAgentImportResult> {
    const prepared = (request as Partial<SubAgentPreparedImportRequest>).prepared;
    const items = prepared ? checkedItems(prepared.items, prepared.importId) : null;
    if (!prepared || !items || !this.isCurrent(prepared)) return Promise.reject(importFailure());
    return this.context.serialize(async () => {
      if (!this.isCurrent(prepared)) throw importFailure();
      let registry = this.context.readRegistry();
      const missing = items.filter((item) => !locate(registry, item.conversationEvidenceId));
      if (missing.length > 0) {
        registry = registerConversationEvidence(
          registry,
          missing.map((item) => item.chunk),
          missing[0].collectedAt,
        ).registry;
        this.context.writeRegistry(registry);
      }
      if (!this.isCurrent(prepared)) throw importFailure();
      await this.context.saveRegistry(frozenCopy(registry));
      if (!this.isCurrent(prepared)) throw importFailure();
      return { outcome: registeredOutcome(prepared, items, registry) };
    });
  }

  async resolve(outcome: ImportedSubAgentRunOutcome): Promise<ResearchEvidenceSnapshot> {
    const entry = this.context.lookup()?.committed(outcome);
    const items = entry ? checkedItems(entry.evidence, entry.importId) : null;
    if (!entry || !items) throw importFailure();
    const registry = this.context.readRegistry();
    const evidence: RetrievedChunk[] = [];
    const provenance: ResearchEvidenceSnapshot["provenance"][number][] = [];
    for (const alias of entry.aliases) {
      const located = locate(registry, alias.conversationEvidenceId);
      const item = items.find((row) => row.conversationEvidenceId === alias.conversationEvidenceId);
      if (!located || !item || located.revision.id !== alias.conversationRevisionId) {
        throw importFailure();
      }
      evidence.push(structuredClone(located.chunk));
      provenance.push({
        evidenceId: alias.conversationEvidenceId,
        calls: item.calls.map((call) => ({ ...call })),
      });
    }
    return frozenCopy({
      evidence,
      citations: evidence.map((chunk) => ({ ...formatCitation(chunk.source), id: chunk.id })),
      provenance,
    });
  }

  private isCurrent(prepared: SubAgentPreparedImport): boolean {
    return this.context.lookup()?.isCurrent(prepared) === true;
  }
}

function registeredOutcome(
  prepared: SubAgentPreparedImport,
  items: readonly SubAgentImportItem[],
  registry: ConversationSourceRegistry,
): ImportedSubAgentRunOutcome {
  const evidence: ImportedSubAgentEvidenceReference[] = [];
  for (const item of items) {
    const located = locate(registry, item.conversationEvidenceId);
    if (!located) throw importFailure();
    evidence.push({
      conversationEvidenceId: item.conversationEvidenceId,
      conversationSourceId: located.source.id,
      conversationRevisionId: located.revision.id,
      subAgentEvidenceId: item.subAgentEvidenceId,
      subAgentSessionId: prepared.sessionId,
      subAgentRunId: prepared.runId,
      collectedAt: item.collectedAt,
      attempt: item.attempt,
      incomplete: item.incomplete,
    });
  }
  return {
    run: { subAgentRunId: prepared.runId } as SubAgentRunSummary,
    answerText: prepared.answerText,
    evidence,
    importId: prepared.importId,
  };
}

function checkedItems(values: readonly unknown[], importId: string): SubAgentImportItem[] | null {
  return readSubAgentImportItems(
    values as Parameters<typeof readSubAgentImportItems>[0],
    subAgentAliasPrefix(importId),
  );
}

function locate(registry: ConversationSourceRegistry, chunkId: string): LocatedChunk | null {
  for (const source of registry.sources) {
    for (const revision of source.revisions) {
      const chunk = revision.chunks.find((candidate) => candidate.id === chunkId);
      if (chunk) return { source, revision, chunk };
    }
  }
  return null;
}

function frozenCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function importFailure(): SubAgentSessionFailure {
  return new SubAgentSessionFailure(subAgentSessionError("import-failed"));
}
