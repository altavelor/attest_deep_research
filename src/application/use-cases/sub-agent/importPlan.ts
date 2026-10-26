import type { SubAgentExecutionResult, SubAgentPreparedImport } from "@application/ports/subAgent";
import { validatePublicWebUrl } from "@application/sources/WebUrlPolicy";
import { canonicalSourceKey } from "@core/chat/sourceRegistry";
import {
  admitSubAgentEvidence,
  MAX_IMPORTED_ANSWER_CHARS,
  MAX_IMPORTED_EVIDENCE_ITEMS,
  parseSubAgentChildEvidence,
  rewriteSubAgentCitations,
  subAgentAliasPrefix,
  subAgentAllowedHosts,
  type SubAgentChildEvidence,
  type SubAgentImportItem,
  type SubAgentRunSummary,
  type SubAgentSourcePolicy,
} from "@core/research";
import { sha256Hex } from "@shared";
import { digestOf } from "./digest";

export interface SubAgentImportPlanInput {
  chatId: string;
  sessionId: string;
  runId: string;
  generation: number;
  attempt: number;
  policy: SubAgentSourcePolicy;
  resources: readonly string[];
  webCapacity: number;
  incomplete: boolean;
  result: SubAgentExecutionResult;
  now: string;
}

export interface SubAgentImportPlan {
  prepared: SubAgentPreparedImport;
  evidenceDigest: string;
}

const RESULT_SUMMARY_CHARS = 1_000;

/** Returns the public run summary of an imported run, whose summary is the rewritten answer. */
export function importedRunSummary(
  run: SubAgentRunSummary,
  answerText: string,
): SubAgentRunSummary {
  return { ...run, resultSummary: importedSummary(answerText) };
}

/** Returns the bounded run summary taken from a rewritten, alias-only answer. */
export function importedSummary(answerText: string): string | null {
  return answerText.trim().slice(0, RESULT_SUMMARY_CHARS) || null;
}

/**
 * Plans one child import deterministically: untrusted evidence is parsed, filtered by
 * the session's source policy and sorted by source identity, so the same evidence gives
 * the same importId and aliases. Dropped and foreign citation tokens are removed from
 * the answer, which then cites only this import's aliases.
 */
export function planSubAgentImport(input: SubAgentImportPlanInput): SubAgentImportPlan {
  const parsed = input.result.evidence
    .slice(0, MAX_IMPORTED_EVIDENCE_ITEMS * 4)
    .map((value) => parseSubAgentChildEvidence(value, normalizeWebUrl))
    .filter((item): item is SubAgentChildEvidence => item !== null);
  const { admitted, evidenceBudgetExhausted } = admitSubAgentEvidence(
    parsed,
    subAgentAllowedHosts(input.resources),
    input.policy,
    input.webCapacity,
  );
  const keyed = admitted
    .map((item) => ({ item, key: identityKey(item) }))
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  const evidenceDigest = digestOf(keyed.map((entry) => entry.key));
  const importId = `import-${digestOf({
    chatId: input.chatId,
    sessionId: input.sessionId,
    runId: input.runId,
    evidenceDigest,
  }).slice(0, 32)}`;
  const prefix = subAgentAliasPrefix(importId);
  const replacements = new Map<string, string>();
  const items = keyed.map(({ item }, index): SubAgentImportItem => {
    const alias = `${prefix}${index + 1}`;
    replacements.set(item.id, alias);
    if (item.source.kind === "web") replacements.set(`url:${item.source.url}`, alias);
    return importItem(item, alias, item.collectedAt ?? input.now, input);
  });
  const aliases = new Set(replacements.values());
  const answerText = rewriteSubAgentCitations(
    input.result.answerText.slice(0, MAX_IMPORTED_ANSWER_CHARS),
    replacements,
    aliases,
  );
  return {
    evidenceDigest,
    prepared: {
      importId,
      chatId: input.chatId,
      sessionId: input.sessionId,
      runId: input.runId,
      generation: input.generation,
      attempt: input.attempt,
      items,
      answerText,
      evidenceBudgetExhausted,
    },
  };
}

function importItem(
  item: SubAgentChildEvidence,
  alias: string,
  collectedAt: string,
  input: SubAgentImportPlanInput,
): SubAgentImportItem {
  const source =
    item.source.kind === "web"
      ? { ...item.source, id: alias, retrievedAt: collectedAt }
      : { ...item.source, id: alias };
  return {
    conversationEvidenceId: alias,
    subAgentEvidenceId: item.id,
    chunk: { id: alias, source, text: item.text, contentHash: sha256Hex(item.text), score: 1 },
    calls: [
      {
        callId: `${alias}:call`,
        tool: item.tool,
        ...(item.query !== undefined ? { query: item.query } : {}),
      },
    ],
    collectedAt,
    attempt: input.attempt,
    incomplete: input.incomplete,
  };
}

function identityKey(item: SubAgentChildEvidence): string {
  return `${item.source.kind}|${canonicalSourceKey(item.source)}|${sha256Hex(item.text)}|${item.id}`;
}

/** Returns the canonical public form of a web URL, or null when it is unsafe or invalid. */
export function normalizeWebUrl(url: string): string | null {
  const validated = validatePublicWebUrl(url);
  return validated.ok ? validated.url : null;
}
