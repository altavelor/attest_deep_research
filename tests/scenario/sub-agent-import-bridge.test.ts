import { describe, expect, it } from "vitest";

import { ResearchEvidenceRegistry } from "@adapters/research-tools/ResearchEvidenceRegistry";
import { ChatStorageError } from "@application/ports";
import {
  recordConversationCitationUsages,
  registerConversationEvidence,
} from "@core/chat/sourceRegistry";
import { settle } from "../support/async";
import { chatInput, ScriptedChatRepository } from "../support/chatDocuments";
import { childEvidence, executionResult, importHarness } from "../support/subAgentSessions";

describe("chat evidence bridge over the chat repository", () => {
  it("S1: a failed registry save is repaired without rollback while the parent cites the source", async () => {
    const repository = new ScriptedChatRepository();
    const harness = importHarness({
      save: (sourceRegistry) =>
        repository.commitChatDocument({ chatId: "chat-1", chat: chatInput({ sourceRegistry }) }),
    });
    const delegator = harness.delegator();
    const session = await delegator.create({ createRequestId: "create-a", title: "Task" });
    const { runId } = await delegator.run(
      session.subAgentSessionId,
      { type: "initial", task: "Find X" },
      "submit-a",
    );
    repository.failNext(new ChatStorageError("file-too-large", "too large"));
    harness.execution.finish(0, {
      ...executionResult("Child [e1]"),
      evidence: [childEvidence("e1")],
    });
    await settle();
    const failed = await delegator.getResult(session.subAgentSessionId, runId);
    const keptAfterFailure = JSON.stringify(harness.chat.registry);

    const parent = registerConversationEvidence(
      harness.chat.registry,
      [
        {
          id: "web:parent",
          source: {
            id: "web:parent",
            kind: "web",
            title: "Parent",
            url: "https://example.com/e1",
            snippet: "Text of e1",
            retrievedAt: "2026-10-26T10:00:00.000Z",
            wasContentFetched: false,
          },
          text: "Text of e1",
          contentHash: "parent",
          score: 1,
        },
      ],
      "2026-10-26T10:00:00.000Z",
    );
    harness.chat.registry = recordConversationCitationUsages(
      parent.registry,
      "message-1",
      "Parent [web:parent].",
      parent.revisionIdByEvidenceId,
    );
    const citedRevision = parent.revisionIdByEvidenceId.get("web:parent");
    harness.probes.epoch = 2;
    const next = harness.delegator("grant-1", 2);
    await next.getResult(session.subAgentSessionId, runId);
    await settle();
    const repaired = await next.getResult(session.subAgentSessionId, runId);

    expect(failed).toMatchObject({ state: "failed", error: { code: "import-failed" } });
    expect(keptAfterFailure).toContain("subagent:");
    expect(repaired.state).toBe("completed");
    if (repaired.state !== "completed") return;
    const resolved = await harness.bridge.resolve(repaired.outcome);
    const alias = repaired.outcome.evidence[0];
    const sources = harness.chat.registry.sources;
    expect(sources).toHaveLength(1);
    expect(sources[0].revisions.map((revision) => revision.id)).toContain(citedRevision);
    expect(sources[0].revisions.map((revision) => revision.id)).toContain(
      alias.conversationRevisionId,
    );
    expect(resolved.evidence.map((chunk) => chunk.id)).toEqual([alias.conversationEvidenceId]);
    expect(resolved.citations[0].id).toBe(alias.conversationEvidenceId);
    expect(resolved.provenance[0].calls[0]).toMatchObject({ tool: "search_web", query: "q" });
    const runRegistry = new ResearchEvidenceRegistry({ createHandle: () => "result_1" });
    const handle = runRegistry.registerWebResult(
      { url: "https://example.com/e1", title: "Parent", snippet: "s", rank: 1 },
      { callId: "c1", query: "q" },
    );
    runRegistry.importRegisteredSnapshot(resolved);
    runRegistry.importRegisteredSnapshot(resolved);
    expect(runRegistry.snapshot().evidence.map((chunk) => chunk.id)).toEqual([
      handle.evidenceId,
      alias.conversationEvidenceId,
    ]);
    expect(runRegistry.resolveWebResult("result_1")?.evidenceId).toBe(handle.evidenceId);
    expect(JSON.stringify(repository.commits.at(-1)?.chat?.sourceRegistry)).toContain(
      alias.conversationEvidenceId,
    );
  });
});
