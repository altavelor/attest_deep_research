import type { ResearchRequest, ResearchStreamEvent } from "@application/contracts/research";
import { createResearchLabelCatalogue } from "@adapters/i18n";
import { RESEARCH_LANGUAGE_RULE, label } from "@core/research/deepResearch";
import { collectAsync } from "../support/async";
import {
  BranchModelRounds,
  MemoryResearchState,
  PlanAndReportModel,
  ResearchRegistry,
  deepResearchService,
} from "../support/deepResearch";
import { markdownSource, retrieved } from "../support/factories";
import { FakeRetriever } from "../support/researchFakes";

const catalogue = createResearchLabelCatalogue();

function answerText(events: readonly ResearchStreamEvent[]): string {
  const last = events.at(-1);
  return last?.type === "complete" ? last.answer.answer : "";
}

function session() {
  const model = new PlanAndReportModel();
  const registry = new ResearchRegistry();
  const port = new MemoryResearchState();
  const answer = (request: Omit<ResearchRequest, "mode" | "researchState">) =>
    collectAsync(
      deepResearchService(model, {
        retriever: new FakeRetriever({
          chunks: [
            retrieved(
              "chunk-tides-1",
              markdownSource("Notes/tides.md"),
              "The moon pulls the oceans and causes tides twice a day.",
            ),
          ],
          citations: [],
          usedFallback: false,
        }),
        modelRound: new BranchModelRounds(),
      }).answer({
        ...request,
        mode: "deep-research",
        researchState: port,
        finalizeAnswer: registry.finalizeAnswer,
        resolveEvidence: registry.resolveEvidence,
      }),
    );
  const decide = (action: string) => {
    const pending = port.commits.at(-1)!;
    return answer({
      question: action,
      research: {
        type: "decision",
        decision: {
          researchId: pending.researchId,
          decisionId: pending.pending!.decisionId,
          expectedRevision: pending.revision,
          payload: { action },
        },
      },
    });
  };
  return { model, port, answer, decide };
}

describe("deep research language", () => {
  it("writes the turn answers and the report of a Russian question with Russian labels", async () => {
    const run = session();
    const ru = catalogue.labelsFor("ru");

    const planned = await run.answer({ question: "Почему на Земле бывают приливы?" });
    expect(run.port.commits.at(-1)!.language).toBe("ru");
    expect(answerText(planned)).toBe(label(ru, "turnPlanReady", { count: 3 }));
    const report = answerText(await run.decide("approve"));

    expect(report).toContain(label(ru, "removedCitations", { count: 1 }));
    expect(report).toContain(label(ru, "stopReasonLine", { reason: ru.stopSettled }));
    const systems = run.model.requests.map((request) => String(request.messages[0]?.content));
    expect(systems.length).toBeGreaterThan(3);
    expect(systems.filter((text) => !text.includes(RESEARCH_LANGUAGE_RULE))).toEqual([]);

    for (const failure of [new Error("down"), "down"]) {
      const port = new MemoryResearchState();
      const broken = {
        listModels: async () => ["model"],
        async *streamChat(): AsyncIterable<never> {
          throw failure;
        },
      };
      await expect(
        collectAsync(
          deepResearchService(broken).answer({
            question: "Почему на Земле бывают приливы?",
            mode: "deep-research",
            researchState: port,
          }),
        ),
      ).rejects.toThrow();
      expect(port.commits.at(-1)).toMatchObject({ phase: "failed", terminalReason: ru.planFailed });
    }
  });

  it("falls back to English labels for a language without a catalogue", async () => {
    const run = session();
    const en = catalogue.labelsFor("en");

    await run.answer({ question: "なぜ潮の満ち引きが起こるのですか" });
    expect(run.port.commits.at(-1)!.language).toBe("ja");
    const cancel = { type: "cancel" as const, researchId: run.port.commits.at(-1)!.researchId };
    expect(answerText(await run.answer({ question: "Cancel", research: cancel }))).toBe(
      en.turnCancelled,
    );
    expect(run.port.commits.at(-1)!.terminalReason).toBe(en.cancelledByUser);
  });
});
