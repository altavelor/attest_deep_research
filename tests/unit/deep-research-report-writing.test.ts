import { ENGLISH_RESEARCH_LABELS, formatWithoutModel } from "@core/research/deepResearch";
import { ReportSynthesisService } from "@application/use-cases/research/deep-research";
import { writeReportMarkdown } from "@application/use-cases/research/deep-research/researchReportWriting";
import { gatheringResearch, researchBranch, researchPlan } from "../support/deepResearch";
import { markdownSource, retrieved } from "../support/factories";
import { FakeChatModel } from "../support/researchFakes";

describe("deep research report writing", () => {
  it("lists the findings with their sources and the missing branches without a model", () => {
    const plan = researchPlan([researchBranch(1), researchBranch(2)], "balanced");
    const [first, second] = gatheringResearch(plan).executions;
    const done = {
      ...first!,
      state: "completed" as const,
      finding: { text: "The moon causes tides [t1].", citationTokens: ["t1"], partial: false },
    };
    const missing = { ...second!, terminalReason: "Out of time." };

    const markdown = formatWithoutModel(plan, [done, missing], "Stop.", ENGLISH_RESEARCH_LABELS);

    expect(markdown).toContain("Unverified findings are listed per branch");
    expect(markdown).toContain("The moon causes tides [t1].\n\nSources: [t1]");
    expect(markdown).toContain("Out of time.");
  });

  it("writes the report from every finding and the contested points of the discovery", async () => {
    const plan = researchPlan([researchBranch(1)], "balanced");
    const execution = {
      ...gatheringResearch(plan).executions[0]!,
      workId: "w-1",
      state: "completed" as const,
      finding: { text: "The moon causes tides [t1].", citationTokens: ["t1"], partial: false },
    };
    const model = new FakeChatModel([
      [{ content: "Tides follow the moon [t1] and wind lifts waves [t2].", isComplete: true }],
    ]);
    const written = await writeReportMarkdown({
      question: "Tides?",
      plan,
      executions: [execution],
      discovery: {
        hypotheses: [
          {
            hypothesisId: "h-1",
            revision: 1,
            previousRevision: null,
            branchId: execution.branchId,
            claim: "Wind lifts waves.",
            alternative: "Only the moon lifts waves.",
            prediction: "p",
            disconfirmation: "d",
            status: "supported",
            observationIds: ["o-1"],
          },
        ],
        tests: [],
        observations: [
          {
            observationId: "o-1",
            testId: "t-1",
            producer: "source",
            citationTokens: ["t2"],
            verdict: "supports",
            quote: "Wind builds waves.",
            limitations: [],
            observedAt: null,
            receivedAt: "2026-11-25T00:00:00.000Z",
          },
        ],
        cycles: [],
        notes: [],
        executions: [],
        omissions: [],
      },
      stopReason: "Stop.",
      labels: ENGLISH_RESEARCH_LABELS,
      synthesis: new ReportSynthesisService({ chatModel: model, model: "model", chatOptions: {} }),
      spendRound: () => true,
      now: new Date("2026-11-25T00:00:00.000Z"),
      resolveEvidence: () => [retrieved("t1", markdownSource("Notes/a.md"), "The moon pulls.")],
    });

    const request = String(model.requests[0]!.messages.at(-1)!.content);
    expect(request).toContain("The moon causes tides [t1].");
    expect(request).toContain(
      '<contested outcome="the first position held in the source check">\n<position>Wind lifts waves.</position>\n<other-position>Only the moon lifts waves.</other-position>\n<quote>Wind builds waves.</quote>\n[t2]',
    );
    expect(written.synthesized).toBe(true);
    expect(written.markdown).toContain("wind lifts waves [t2].");
    expect(written.markdown).toContain("Stop reason: Stop.");
  });
});
