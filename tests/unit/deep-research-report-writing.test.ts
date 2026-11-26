import { ENGLISH_RESEARCH_LABELS, formatWithoutModel } from "@core/research/deepResearch";
import { ReportSynthesisService } from "@application/use-cases/research/deep-research";
import {
  citedSourceCount,
  writeReportMarkdown,
} from "@application/use-cases/research/deep-research/researchReportWriting";
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

    expect(markdown).toContain("Findings are listed per branch without a synthesized summary.");
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
            observationIds: ["o-1", "o-2"],
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
          {
            observationId: "o-2",
            testId: "t-1",
            producer: "user",
            citationTokens: [],
            verdict: "supports",
            quote: "My tide log agrees.",
            limitations: [],
            observedAt: null,
            receivedAt: "2026-11-25T00:00:00.000Z",
          },
        ],
        cycles: [],
        notes: [],
        executions: [],
        omissions: ["The wind test was skipped."],
      },
      stopReason: "Stop.",
      labels: ENGLISH_RESEARCH_LABELS,
      synthesis: new ReportSynthesisService({ chatModel: model, model: "model", chatOptions: {} }),
      spendRound: () => true,
      now: new Date("2026-11-25T00:00:00.000Z"),
      resolveEvidence: (tokens) =>
        tokens.map((token) => retrieved(token, markdownSource("Notes/a.md"), "The moon pulls.")),
    });

    const request = String(model.requests[0]!.messages.at(-1)!.content);
    expect(request).toContain("The moon causes tides [t1].");
    expect(request).toContain(
      '<contested outcome="the first position held in the source check">\n<position>Wind lifts waves.</position>\n<other-position>Only the moon lifts waves.</other-position>\n<quote>Wind builds waves.</quote>\n<user-report>My tide log agrees.</user-report>\n[t2]',
    );
    expect(request).toContain("<omission>The wind test was skipped.</omission>");
    expect(written.synthesized).toBe(true);
    expect(written.markdown).toContain("wind lifts waves [t2].");
    expect(written.markdown).toContain("Stop reason: Stop.");
  });

  it("removes the citation tokens of contested points that no registry lookup resolves", async () => {
    const plan = researchPlan([researchBranch(1)], "balanced");
    const execution = {
      ...gatheringResearch(plan).executions[0]!,
      state: "completed" as const,
      finding: {
        text: "Tides [source-1:revision-1].",
        citationTokens: ["source-1:revision-1"],
        partial: false,
      },
    };
    const model = new FakeChatModel([
      [{ content: "Report [source-1:revision-1] [source-2:revision-2].", isComplete: true }],
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
            claim: "A",
            alternative: "B",
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
            citationTokens: ["source-2:revision-2"],
            verdict: "supports",
            quote: null,
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
      resolveEvidence: (tokens) =>
        tokens
          .filter((token) => token === "source-1:revision-1")
          .map((token) => retrieved(token, markdownSource("Notes/a.md"), "x")),
    });

    expect(String(model.requests[0]!.messages.at(-1)!.content)).not.toContain(
      "[source-2:revision-2]",
    );
    expect(written.markdown).not.toContain("[source-2:revision-2]");
  });

  it("names the branches that cite no source and counts removed and cited sources", async () => {
    const plan = researchPlan([researchBranch(1), researchBranch(2)], "balanced");
    const [first, second] = gatheringResearch(plan).executions;
    const finding = (text: string, citationTokens: string[]) => ({
      text,
      citationTokens,
      partial: false,
    });
    const executions = [
      {
        ...first!,
        state: "completed" as const,
        finding: finding("Tides [source-1:revision-1] [source-9:revision-9].", [
          "source-1:revision-1",
          "source-9:revision-9",
        ]),
      },
      { ...second!, state: "completed" as const, finding: finding("Wind.", []) },
    ];
    const resolveEvidence = (tokens: readonly string[]) =>
      tokens
        .filter((token) => token === "source-1:revision-1")
        .map((token) => retrieved(token, markdownSource("Notes/a.md"), "x"));

    const written = await writeReportMarkdown({
      question: "Tides?",
      plan,
      executions,
      discovery: null,
      stopReason: "Stop.",
      labels: ENGLISH_RESEARCH_LABELS,
      synthesis: {} as ReportSynthesisService,
      spendRound: () => false,
      now: new Date("2026-11-25T00:00:00.000Z"),
      resolveEvidence,
    });

    expect([
      written.removedCitations,
      written.uncitedBranches,
      citedSourceCount(written.markdown, resolveEvidence),
      citedSourceCount(written.markdown, undefined),
    ]).toEqual([1, [{ branchId: second!.branchId, title: plan.branches[1]!.title }], 1, 0]);
  });
});
