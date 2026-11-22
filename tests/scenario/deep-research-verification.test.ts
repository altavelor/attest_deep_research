import type { ChatModelProvider, ChatRequest, ChatResponseChunk } from "@core/agent";
import { collectAsync } from "../support/async";
import {
  BranchModelRounds,
  MemoryResearchState,
  ResearchRegistry,
  cooperativeResearchReply,
  deepResearchService,
  gatheringResearch,
  researchBranch,
  researchPlan,
} from "../support/deepResearch";
import { markdownSource, retrieved } from "../support/factories";
import { FakeRetriever } from "../support/researchFakes";

class FirstAssessmentFailsModel implements ChatModelProvider {
  readonly requests: ChatRequest[] = [];
  private assessments = 0;

  async listModels(): Promise<string[]> {
    return ["model"];
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    this.requests.push(request);
    const assess = String(request.messages[0]?.content).startsWith("You check claims");
    if (assess && (this.assessments += 1) === 1) {
      yield { content: "{}", isComplete: true };
      return;
    }
    yield { content: cooperativeResearchReply(request) ?? "# Summary\n\nTides.", isComplete: true };
  }
}

describe("deep research verification", () => {
  it("follows up an uncovered objective once, re-verifies only the new finding and reports the rest", async () => {
    const plan = researchPlan(
      [researchBranch(1), researchBranch(2, { objectives: ["Second"] })],
      "balanced",
      { objectives: ["Objective", "Second"] },
    );
    const state = gatheringResearch(plan);
    const port = new MemoryResearchState();
    port.commits.push(state);
    const model = new FirstAssessmentFailsModel();
    const rounds = new BranchModelRounds();
    const registry = new ResearchRegistry();
    await collectAsync(
      deepResearchService(model, true, {
        retriever: new FakeRetriever({
          chunks: [
            retrieved("chunk-1", markdownSource("Notes/tides.md"), "The moon pulls the oceans."),
          ],
          citations: [],
          usedFallback: false,
        }),
        modelRound: rounds,
        now: () => new Date("2026-01-01T01:00:00.000Z"),
      }).answer({
        question: "Continue",
        mode: "deep-research",
        researchState: port,
        research: { type: "continue", researchId: state.researchId },
        finalizeAnswer: registry.finalizeAnswer,
        resolveEvidence: registry.resolveEvidence,
      }),
    );

    const final = port.commits.at(-1)!;
    const verification = [...port.commits]
      .reverse()
      .find((entry) => entry.verification)!.verification!;
    expect(verification.followUpsUsed).toBe(1);
    expect(verification.followUps).toMatchObject([
      { workId: "branch-1-follow-up-1", state: "completed" },
    ]);
    expect(rounds.tasks.filter((task) => task.startsWith("Follow up on"))).toHaveLength(1);
    const extracts = model.requests.filter((request) =>
      String(request.messages[0]?.content).startsWith("You extract"),
    );
    expect(
      extracts.map(
        (request) => String(request.messages.at(-1)?.content).split("<finding").length - 1,
      ),
    ).toEqual([2, 1]);
    expect(verification.coverage).toEqual([
      { objective: "Objective", covered: true },
      { objective: "Second", covered: false },
    ]);
    expect(final.report).toMatchObject({
      quality: "partial",
      verification: { supported: 1, unresolved: 2, uncoveredObjectives: ["Second"] },
    });
    expect(final.report!.markdown).toContain("## Unsupported or unresolved claims");
    expect(final.report!.markdown).toContain("## Uncovered objectives\n\n- Second");
  });
});
