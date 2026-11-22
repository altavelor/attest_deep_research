import type { ResearchRequest } from "@application/contracts/research";
import type { ResearchServiceOptions } from "@application/use-cases/research";
import type { SubAgentSessionManagerContext } from "@application/ports/subAgent";
import { ResearchScopeRouter } from "@application/use-cases/research/deep-research";
import type { SavedChatSettings } from "@core/chat/savedChat";
import { researchBranch, researchPlan } from "../support/deepResearch";
import { collectAsync, eventually, settle } from "../support/async";
import { realSubAgentChat, startResearchTurn } from "../support/chatSubAgentWiring";
import {
  BranchModelRounds,
  CitingReportModel,
  MemoryResearchState,
  deepResearchService,
  gatheringResearch,
} from "../support/deepResearch";
import { markdownSource, retrieved } from "../support/factories";
import { MemoryFileSystem } from "../support/memoryFileSystem";
import { FakeRetriever } from "../support/researchFakes";
import { validateResearchSection, type ResearchState } from "@core/research/deepResearch";

const PARALLEL = { calls: true, choiceRequired: true, choiceSpecific: true, parallelCalls: true };

const SETTINGS: SavedChatSettings = {
  chatModelProfileId: "model",
  searchMode: "indexOnly",
  researchMode: "deep-research",
};

function retriever() {
  return new FakeRetriever({
    chunks: [
      retrieved("chunk-tides-1", markdownSource("Notes/tides.md"), "The moon causes tides."),
    ],
    citations: [],
    usedFallback: false,
  });
}

function researchRun(
  request: ResearchRequest,
  state: ResearchState,
  rounds: BranchModelRounds,
  signal?: AbortSignal,
  options: Partial<ResearchServiceOptions> = {},
) {
  const port = new MemoryResearchState();
  port.commits.push(state);
  const model = new CitingReportModel();
  const events = collectAsync(
    deepResearchService(model, true, {
      retriever: retriever(),
      modelRound: rounds,
      now: () => new Date("2026-01-01T01:00:00.000Z"),
      ...options,
    }).answer({
      ...request,
      mode: "deep-research",
      researchState: port,
      ...(signal ? { signal } : {}),
    }),
  );
  return { port, model, events };
}

describe("deep research branches as child sessions", () => {
  it("runs two branches in one child session each and cites their imported evidence", async () => {
    const chat = realSubAgentChat(new MemoryFileSystem());
    const session = chat.manager.createSession(SETTINGS);
    const state = gatheringResearch(
      researchPlan([researchBranch(1), researchBranch(2)], "balanced"),
    );
    const { request } = await startResearchTurn(chat, session.sessionId, state.researchId);
    const run = researchRun(request, state, new BranchModelRounds());
    await run.events;
    const final = run.port.commits.at(-1)!;
    expect(final.phase).toBe("completed");
    const sessions = Object.values(final.sessionByBranch);
    expect(Object.keys(final.sessionByBranch)).toEqual(["branch-1", "branch-2"]);
    expect(new Set(sessions).size).toBe(2);
    const settled = run.port.commits.find((entry) => entry.phase === "synthesizing")!.executions;
    expect(settled.map((entry) => [entry.path, entry.runRef?.sessionId])).toEqual([
      ["sub-agent", sessions[0]],
      ["sub-agent", sessions[1]],
    ]);
    const tokens = settled.flatMap((entry) => entry.finding!.citationTokens);
    expect(tokens).toHaveLength(2);
    expect(request.resolveEvidence!(tokens)).toHaveLength(1);
    expect(final.report!.markdown).toContain(`Fact [${tokens[0]}].`);
  });

  it("sends the follow-up of a continued research to the branch session of the earlier turn", async () => {
    const chat = realSubAgentChat(new MemoryFileSystem());
    const session = chat.manager.createSession(SETTINGS);
    const state = gatheringResearch(
      researchPlan([researchBranch(1), researchBranch(2)], "balanced"),
    );
    const rounds = new BranchModelRounds();
    rounds.hang.add("aspect 2");
    const stop = new AbortController();
    rounds.onHang = () => stop.abort();
    const first = await startResearchTurn(chat, session.sessionId, state.researchId);
    const stopped = researchRun(first.request, state, rounds, stop.signal);
    await expect(stopped.events).rejects.toMatchObject({ name: "AbortError" });
    chat.research.end(first.index);
    await settle();
    const paused = validateResearchSection(
      JSON.parse(JSON.stringify({ schema: 1, active: stopped.port.commits.at(-1), history: [] })),
    );
    const resumed = paused.ok ? paused.value.active! : state;
    const earlier = resumed.sessionByBranch["branch-2"];
    expect(earlier).toBeDefined();

    rounds.hang.clear();
    const second = await startResearchTurn(chat, session.sessionId, state.researchId);
    const run = researchRun(second.request, resumed, rounds);
    await run.events;

    const final = run.port.commits.at(-1)!;
    expect(final.phase).toBe("completed");
    expect(final.sessionByBranch).toEqual(resumed.sessionByBranch);
    expect(
      run.port.commits.find((entry) => entry.phase === "synthesizing")!.executions[1]!.runRef
        ?.sessionId,
    ).toBe(earlier);
    expect(await second.request.subAgentParent!.listSessions!()).toHaveLength(2);
  });

  it("stops the children of both branch scopes at the time limit", async () => {
    const chat = realSubAgentChat(new MemoryFileSystem());
    const session = chat.manager.createSession(SETTINGS);
    const state = gatheringResearch(
      researchPlan([researchBranch(1), researchBranch(2)], "balanced"),
    );
    const rounds = new BranchModelRounds();
    rounds.hang.add("aspect");
    let fire: () => void = () => undefined;
    let hanging = 0;
    rounds.onHang = () => {
      hanging += 1;
      if (hanging === 2) fire();
    };
    const { request } = await startResearchTurn(chat, session.sessionId, state.researchId);
    const run = researchRun(request, state, rounds, undefined, {
      toolCapabilities: PARALLEL,
      researchTimer: (_delay, callback) => {
        fire = callback;
        return () => undefined;
      },
    });
    await run.events;
    await settle();

    const states = (await request.subAgentParent!.listSessions!()).map((entry) => entry.state);
    expect(states).toEqual(["interrupted", "interrupted"]);
  });

  it("lets running branches finish after the evidence total is reached and admits nothing new", async () => {
    const chat = realSubAgentChat(new MemoryFileSystem());
    const session = chat.manager.createSession(SETTINGS);
    const plan = researchPlan(
      [researchBranch(1), researchBranch(2), researchBranch(3, { dependsOn: ["branch-1"] })],
      "balanced",
    );
    const state = gatheringResearch({ ...plan, limits: { ...plan.limits, evidenceItemsTotal: 1 } });
    const rounds = new BranchModelRounds();
    rounds.hang.add("aspect 2");
    const { request } = await startResearchTurn(chat, session.sessionId, state.researchId);
    const run = researchRun(request, state, rounds, undefined, { toolCapabilities: PARALLEL });
    await eventually(() => expect(run.port.commits.at(-1)!.executions[0]!.state).toBe("completed"));
    const startedAtClosure = rounds.startedRounds;
    rounds.releaseHangs();
    await run.events;

    const final = run.port.commits.find((entry) => entry.phase === "synthesizing")!;
    expect(final.budget!.closed).toEqual({ reason: "exhausted", dimension: "evidenceItems" });
    expect(rounds.startedRounds).toBeGreaterThan(startedAtClosure);
    expect(final.executions.map((entry) => entry.attempts)).toEqual([1, 1, 0]);
    expect(Object.keys(final.sessionByBranch)).toEqual(["branch-1", "branch-2"]);
  });

  it("never runs two model rounds at once on a provider without parallel requests", async () => {
    const chat = realSubAgentChat(new MemoryFileSystem());
    const session = chat.manager.createSession(SETTINGS);
    const branches = [researchBranch(1), researchBranch(2), researchBranch(3)];
    const state = gatheringResearch(researchPlan(branches, "balanced"));
    const rounds = new BranchModelRounds();
    const { request } = await startResearchTurn(chat, session.sessionId, state.researchId);
    const run = researchRun(request, state, rounds);
    await run.events;

    expect(run.port.commits.at(-1)!.report?.completedBranches).toHaveLength(3);
    expect(rounds.peakConcurrentRounds).toBe(1);
  });

  it("moves a branch whose mapped session is refused to the main path within the same attempt", async () => {
    const chat = realSubAgentChat(new MemoryFileSystem());
    const session = chat.manager.createSession(SETTINGS);
    const state = {
      ...gatheringResearch(researchPlan([researchBranch(1)], "balanced")),
      sessionByBranch: { "branch-1": "subagent-session-forged" },
    };
    const { request } = await startResearchTurn(chat, session.sessionId, state.researchId);
    const run = researchRun(request, state, new BranchModelRounds());
    await run.events;

    const final = run.port.commits.find((entry) => entry.phase === "verifying")!;
    expect(final.executions).toMatchObject([{ state: "completed", path: "main", attempts: 1 }]);
    expect(final.budget!.consumed.branchAttempts).toBe(1);
    expect(final.budget!.consumed.modelRounds).toBe(2);
  });

  it("revokes the branch grants of a research run when its parent run closes", async () => {
    let context: SubAgentSessionManagerContext | null = null;
    const chat = realSubAgentChat(new MemoryFileSystem(), (captured) => (context = captured));
    const session = chat.manager.createSession(SETTINGS);
    const { request, index } = await startResearchTurn(chat, session.sessionId, "research-1");
    const plan = researchPlan([researchBranch(1)], "balanced");
    request.subAgentResearch!.attachBudget(
      Object.assign(new ResearchScopeRouter(), { researchId: "research-1" }),
    );
    const allocation = {
      workId: "w-1",
      branchId: "branch-1",
      attempt: 1,
      modelRounds: 3,
      searches: 4,
    };
    request.subAgentResearch!.delegator(plan.branches[0]!, allocation);
    const grantId = `grant-${request.subAgentParent!.parentRunId}-research-branch-1-1`;
    const during = context!.resolveGrant(grantId);

    chat.research.end(index);
    await settle();

    expect(during?.budgetPolicy).toEqual({
      type: "required-scope",
      scopeId: "research:research-1:branch-1",
    });
    expect(context!.resolveGrant(grantId)).toBeNull();
  });
});
