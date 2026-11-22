import { describe, expect, it } from "vitest";

import { createResearchToolRegistry } from "@adapters/research-tools/createResearchToolRegistry";
import type { ResearchRetriever } from "@application/contracts/research";
import type { SubAgentMainEventIntent } from "@application/ports";
import type { SubAgentSessionManager } from "@application/use-cases/sub-agent";
import type { ResearchEvidenceSnapshot } from "@application/sources/evidence";
import {
  MapSources,
  MapSourcesWorkerAdapter,
  type MapSourcesWorkerLimits,
} from "@application/use-cases/map-sources";
import { subAgentToolContext } from "@application/use-cases/research/sub-agent/subAgentToolContext";
import { applySubAgentTimelineEvent } from "@core/chat/subAgentTimeline";
import {
  researchModeRetrievalParameters,
  type MapSourcesBatchRecord,
  type MapSourcesBatchState,
} from "@core/research";
import type { RetrievedChunk } from "@core/model";
import { eventually, settle } from "../support/async";
import {
  batchRecord,
  childEvidence,
  delegationGrant,
  executionResult,
  importHarness,
  launchChild,
  sourcePolicy,
} from "../support/subAgentSessions";

const DOCS = ["Notes/a.md", "Notes/b.md", "Notes/c.md", "Notes/d.md"];

function indexChunk(path: string): RetrievedChunk {
  return {
    id: `chunk-${path}`,
    text: `Text of ${path}`,
    contentHash: path,
    score: 1,
    source: { id: path, kind: "markdown", title: path, path, headingPath: [] },
  };
}

/** A retriever over three documents that answers every read regardless of its scope. */
function twoDocumentRetriever(): ResearchRetriever {
  const chunks = ["Notes/b.md", "Notes/secret.md", "Notes/b.md/child.md"].map(indexChunk);
  return {
    search: async () => ({ chunks, citations: [], usedFallback: false }),
    readIndexChunk: async ({ chunkId }) => ({
      chunks: chunks
        .filter((chunk) => chunk.id === chunkId)
        .map((chunk) => ({
          chunkId: chunk.id,
          sourcePath: (chunk.source as { path: string }).path,
          chunkIndex: 0,
          text: chunk.text,
          charCount: chunk.text.length,
          truncated: false,
          source: chunk.source,
        })),
    }),
  };
}

describe("map_sources batches over the chat's sub-agent manager", () => {
  it("S1: one batch notice, shared FIFO with direct children, scoped workers and a partial matrix", async () => {
    const harness = importHarness();
    const { binding, grants, execution, chat } = harness;
    const manager = harness.manager as unknown as SubAgentSessionManager;
    await launchChild(harness.delegator(), "direct-1");
    await launchChild(harness.delegator(), "direct-2");
    const intents: SubAgentMainEventIntent[] = [];
    const imported: ResearchEvidenceSnapshot[] = [];
    const delegator = (limits: MapSourcesWorkerLimits) => {
      const grantId = `grant-map-${limits.maxRounds}`;
      grants.set(
        grantId,
        delegationGrant(binding, {
          origin: "map_sources",
          maximumSourcePolicy: sourcePolicy({
            searchMode: "indexOnly",
            contextPaths: ["Notes"],
            allowActiveFile: false,
          }),
          limits: { ...limits, maxSearches: 20 },
        }),
      );
      return manager.delegatorFor(binding, { deliveryEpoch: 1, grantId });
    };
    const mapperOf = (sink: (published: SubAgentMainEventIntent[]) => void) =>
      new MapSources({
        runner: new MapSourcesWorkerAdapter({ delegator }),
        retriever: twoDocumentRetriever(),
        context: {
          chatId: "chat-1",
          parentRunId: "parent-1",
          batches: manager.batches(),
          notices: { publish: sink },
          subscribe: (listener) => manager.subscribeResults(listener),
          now: () => new Date("2026-10-26T10:00:00.000Z"),
          redact: (text) => text.replace(/secret/giu, "[redacted]"),
        },
        resolver: harness.bridge,
        evidence: { importRegisteredSnapshot: (snapshot) => void imported.push(snapshot) },
      });
    const mapper = mapperOf((published) => void intents.push(...published));

    const receipt = await mapper.start(
      { question: "Is X true?", sourcePaths: DOCS },
      "parent-1-r1-c",
    );
    const batches = manager.batches();
    await batches.put({ ...batches.get(receipt.batchId)!, state: "preparing", refs: [] }, true);
    const replayed = await mapperOf(() => undefined).start(
      { question: "Is X true?", sourcePaths: DOCS },
      "parent-1-r1-c",
    );

    expect(replayed).toEqual(receipt);
    expect(receipt.refs).toHaveLength(4);
    expect(execution.requests).toHaveLength(4);
    const [, , first, second] = execution.requests;
    expect(first).toMatchObject({
      origin: "map_sources",
      sourcePolicy: {
        searchMode: "indexOnly",
        contextPaths: ["Notes/a.md"],
        indexScope: "paths",
        allowActiveFile: false,
      },
    });
    const workerTools = subAgentToolContext(
      {
        retriever: twoDocumentRetriever(),
        noteTools: { setCitationProvider: () => undefined } as never,
      },
      second!.sourcePolicy,
      researchModeRetrievalParameters("thinking").web,
      second!.origin,
    );
    const scoped = createResearchToolRegistry(workerTools);
    const otherDocument = await scoped.tools.execute({
      id: "read",
      name: "read_index_chunk",
      arguments: { chunkId: "chunk-Notes/secret.md" },
    });
    expect(otherDocument).toMatchObject({ ok: true, value: { chunks: [] } });
    const childPath = await scoped.tools.execute({
      id: "child",
      name: "read_index_chunk",
      arguments: { chunkId: "chunk-Notes/b.md/child.md" },
    });
    expect(childPath).toMatchObject({ ok: true, value: { chunks: [] } });
    expect([workerTools.noteTools, workerTools.availability.noteAccess]).toEqual([
      undefined,
      false,
    ]);

    execution.fail(2);
    await eventually(() => expect(execution.requests).toHaveLength(5));
    expect(execution.requests[4]?.sourcePolicy.contextPaths).toEqual(["Notes/c.md"]);
    execution.finish(0);
    await eventually(() => expect(execution.requests).toHaveLength(6));
    const evidence = [
      childEvidence("e1", {
        source: { kind: "markdown", title: "B", path: "Notes/b.md" },
        tool: "search_index",
      }),
    ];
    execution.finish(3, { ...executionResult("B holds [e1]\nSTANCE: SUPPORTS"), evidence });
    execution.finish(4, executionResult("STANCE: MIXED"));
    execution.finish(5, executionResult("STANCE: OPPOSES"));

    let state: MapSourcesBatchState | null = null;
    await eventually(async () => {
      state = await mapper.getResult(receipt.batchId);
      expect(state.state).toBe("completed");
    });
    const savedImports = chat.saved.length;
    const again = await mapper.getResult(receipt.batchId);
    const rows = again.state === "completed" ? again.result.rows : [];

    expect(rows.map((row) => [row.sourcePath, row.ok])).toEqual([
      ["Notes/a.md", false],
      ["Notes/b.md", true],
      ["Notes/c.md", true],
      ["Notes/d.md", true],
    ]);
    expect(rows[0]?.error).toMatch(/^provider-failed: /u);
    expect(JSON.stringify(rows)).not.toContain("secret details");
    expect(rows[1]?.evidenceIds).toHaveLength(1);
    expect([
      ...new Set(imported.flatMap((item) => item.evidence.map((chunk) => chunk.id))),
    ]).toEqual(rows[1]?.evidenceIds);
    expect(chat.saved).toHaveLength(savedImports);
    const stored = batches.get(receipt.batchId)!;
    expect(await batches.put({ ...stored, state: "interrupted" }, true)).toBe(false);
    await batches.interrupt("parent-1", { code: "parent-terminal", message: "Ended." });
    expect([batches.get(receipt.batchId)?.state, batches.pendingCount("parent-1")]).toEqual([
      "completed",
      0,
    ]);
    expect(batches.batchOf(receipt.refs[3]!)).toBe(receipt.batchId);

    const empty = {
      messages: [],
      subAgentDispatches: [],
      subAgentNotices: [],
      timelineSequence: 0,
    } as Parameters<typeof applySubAgentTimelineEvent>[0];
    let timeline = empty;
    for (const intent of intents) {
      timeline = applySubAgentTimelineEvent(timeline, intent) ?? timeline;
    }
    const firstInsert = applySubAgentTimelineEvent(empty, intents[0]!);
    expect(intents.length).toBeGreaterThan(2);
    expect(timeline.timelineSequence).toBe(firstInsert?.timelineSequence);
    expect(timeline.subAgentNotices).toEqual([
      expect.objectContaining({
        kind: "batch",
        batchId: receipt.batchId,
        sequence: firstInsert?.subAgentNotices[0]?.sequence,
        batch: { total: 4, done: 3, running: 0, failed: 1 },
      }),
    ]);
    const workerSessions = new Set(receipt.refs.map((ref) => ref.sessionId));
    expect(
      harness.mainEvents.filter((intent) => workerSessions.has(intent.entry.sessionId ?? "")),
    ).toEqual([]);

    const open = await mapper.start(
      { question: "Is Y true?", sourcePaths: ["Notes/a.md"] },
      "parent-1-r2-c",
    );
    harness.writer.failNext(new Error("disk full"));
    await expect(
      batches.interrupt("parent-1", { code: "parent-terminal", message: "Ended." }),
    ).rejects.toThrow();
    expect([batches.get(open.batchId)?.state, batches.pendingCount("parent-1")]).toEqual([
      "pending",
      1,
    ]);
    const release = harness.writer.holdNext();
    const interrupting = batches.interrupt("parent-1", {
      code: "parent-terminal",
      message: "Ended.",
    });
    await settle();
    expect([
      (await mapper.getResult(open.batchId)).state,
      batches.pendingCount("parent-1"),
    ]).toEqual(["pending", 1]);
    release();
    await interrupting;
    expect([batches.get(open.batchId), batches.pendingCount("parent-1")]).toEqual([
      expect.objectContaining({
        state: "interrupted",
        error: { code: "parent-terminal", message: "Ended." },
      }),
      0,
    ]);
    await eventually(() =>
      expect(intents.at(-1)?.entry).toMatchObject({
        batchId: open.batchId,
        batch: { total: 1, done: 0, running: 0, failed: 1 },
      }),
    );
  });

  it("S2: settles a batch whose terminal write fails or is held across the parent interrupt", async () => {
    const harness = importHarness();
    const batches = (harness.manager as unknown as SubAgentSessionManager).batches();
    const diagnostics = { selection: "explicit" as const, requested: 0, completed: 0, failed: 0 };
    const finished = (record: MapSourcesBatchRecord): MapSourcesBatchRecord => ({
      ...record,
      state: "completed",
      result: { question: record.question, rows: [], diagnostics },
    });
    const open = batchRecord({ refs: [] });
    harness.writer.failNext(new Error("disk full"));
    await expect(batches.put(finished(open), true)).rejects.toThrow();
    expect(batches.get(open.batchId)).toEqual(open);
    const release = harness.writer.holdNext();
    harness.writer.failNext(new Error("disk full"));
    const failing = batches.put(finished(open), true);
    await settle();
    await batches.interrupt("parent-1", { code: "parent-terminal", message: "Ended." });
    release();
    await expect(failing).rejects.toThrow();
    const held = batchRecord({ batchId: "batch-2", parentRunId: "parent-2", refs: [] });
    await batches.put(held, true);
    const releaseHeld = harness.writer.holdNext();
    const succeeding = batches.put(finished(held), true);
    await settle();
    await batches.interrupt("parent-2", { code: "parent-terminal", message: "Ended." });
    releaseHeld();
    await succeeding;
    await settle();

    expect(
      [open, held].map((record) => {
        const settled = batches.get(record.batchId);
        return [settled?.state, settled?.result, batches.pendingCount(record.parentRunId)];
      }),
    ).toEqual([
      ["interrupted", undefined, 0],
      ["interrupted", undefined, 0],
    ]);
  });
});
