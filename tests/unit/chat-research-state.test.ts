import { ChatResearchState } from "@application/use-cases/chat/ChatResearchState";
import { createIdleSessionState } from "@application/use-cases/chat/chatSessionSnapshots";
import { startResearchState } from "@core/research/deepResearch";
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
});
