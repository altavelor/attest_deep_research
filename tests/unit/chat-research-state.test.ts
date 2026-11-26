import { ChatResearchState } from "@application/use-cases/chat/ChatResearchState";
import { createIdleSessionState } from "@application/use-cases/chat/chatSessionSnapshots";
import {
  MAX_RESEARCH_SECTION_BYTES,
  fitResearchSection,
  startResearchState,
} from "@core/research/deepResearch";
import { pendingResearch } from "../support/deepResearch";

function port() {
  const state = createIdleSessionState("session-1", {
    chatModelProfileId: "profile",
    searchMode: "indexOnly",
  });
  const research = new ChatResearchState({
    state,
    persist: async () => undefined,
    persistLater: () => undefined,
  });
  return { state, research };
}

describe("chat research state port", () => {
  it("refuses a commit whose expected revision is stale", async () => {
    const { research } = port();
    const planning = startResearchState("research-1", "Q", "2026-01-01T00:00:00.000Z");
    await research.commit(planning, null);
    await expect(research.commit(planning, 0)).rejects.toMatchObject({
      details: { reason: "research-revision-conflict" },
    });
  });

  it("refuses a section over 1 MB and keeps the committed one", async () => {
    const { state, research } = port();
    const planning = startResearchState("research-1", "Q", "2026-01-01T00:00:00.000Z");
    await research.commit(planning, null);
    const huge = { ...planning, revision: 2, question: "q".repeat(20_000) };
    const plan = pendingResearch().plan!;
    const branches = Array.from({ length: 300 }, () => ({
      ...plan.branches[0]!,
      task: "t".repeat(4000),
    }));
    const oversized = { ...huge, plan: { ...plan, branches } };
    await expect(research.commit(oversized, 1)).rejects.toMatchObject({
      message: "The research state is larger than 1 MB and was not saved.",
      details: { reason: "research-section-too-large" },
    });
    expect(research.read()).toMatchObject({ status: "ready", active: planning });
    expect(state.deepResearch?.status).toBe("ready");
  });

  it("drops the oldest history entries of an oversized section until it fits", () => {
    const planning = startResearchState("research-1", "Q", "2026-01-01T00:00:00.000Z");
    const active = { ...planning, question: "q".repeat(MAX_RESEARCH_SECTION_BYTES - 70_000) };
    const history = Array.from({ length: 10 }, (_, index) => ({
      researchId: `research-old-${index}`,
      question: "h".repeat(20_000),
      phase: "completed" as const,
      terminalReason: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      report: null,
    }));

    const fitted = fitResearchSection({ schema: 1, active, history });
    expect(fitted?.active).toBe(active);
    expect(fitted?.history.map((entry) => entry.researchId)).toEqual([
      "research-old-0",
      "research-old-1",
      "research-old-2",
    ]);
  });
});
