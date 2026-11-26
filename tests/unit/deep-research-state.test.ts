import {
  emptyBudgetState,
  presetLimits,
  validateResearchSection,
} from "@core/research/deepResearch";
import { pendingResearch, researchBranch, researchPlan } from "../support/deepResearch";

const pending = pendingResearch();
const approved = {
  ...pending,
  phase: "gathering",
  pending: null,
  plan: { ...pending.plan!, approvedAt: "2026-01-02T00:00:00.000Z" },
  executions: [
    {
      workId: "w-1",
      branchId: "branch-1",
      state: "completed",
      path: "main",
      attempts: 1,
      finding: { text: "Found", citationTokens: ["s1r1"], partial: false },
      terminalReason: null,
    },
    {
      workId: "w-2",
      branchId: "branch-2",
      state: "running",
      path: "main",
      attempts: 1,
      finding: null,
      terminalReason: null,
    },
  ],
  budget: {
    ...emptyBudgetState(),
    consumed: { branchAttempts: 2, modelRounds: 3, searches: 2, evidenceItems: 1 },
    attemptsByBranch: { "branch-1": 1, "branch-2": 1 },
    openAllocations: [
      { workId: "w-2", branchId: "branch-2", attempt: 1, modelRounds: 12, searches: 10 },
    ],
  },
};
const [done, running] = approved.executions;
const reportStats = {
  sourcesFound: 12,
  sourcesCited: 3,
  documentsOpened: 0,
  removedCitations: 2,
  uncitedBranches: [{ branchId: "branch-1", title: "Currents" }],
};
const ended = {
  researchId: "research-0",
  question: "Q",
  phase: "cancelled",
  terminalReason: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  report: {
    reportId: "report-1",
    quality: "partial",
    completedBranches: ["branch-1"],
    missingBranches: [{ branchId: "branch-2", reason: "Time" }],
    stopReason: "Time",
    createdAt: "2026-01-01T00:00:00.000Z",
    verification: {
      supported: 1,
      conflicted: 0,
      unsupported: 1,
      unresolved: 0,
      uncoveredObjectives: [],
    },
  },
};
const clarifying = {
  ...pending,
  phase: "awaiting-clarification",
  plan: null,
  pending: { decisionId: "decision-c", kind: "clarification", artifactRevision: 1 },
  brief: {
    questions: [{ questionId: "question-1", prompt: "Which tides?", suggestions: ["Ocean"] }],
    answers: {},
    assumptions: ["Ocean tides"],
  },
};
const claim = {
  claimId: "c-w-1-1",
  workId: "w-1",
  branchId: "branch-1",
  objective: "Objective",
  text: "Found",
  citationTokens: ["s1r1"],
};
const verifying = {
  ...approved,
  phase: "verifying",
  executions: [done, { ...running, state: "completed", finding: done!.finding }],
  verification: {
    claims: [claim],
    assessments: [
      {
        claimId: claim.claimId,
        verdict: "supported",
        quote: "Found",
        contradictingTokens: [],
        independenceGroups: ["g-0000abcd"],
      },
    ],
    coverage: [{ objective: "Objective", covered: true }],
    verifiedWorks: ["w-1", "w-2"],
    followUps: [{ ...running, workId: "branch-2-follow-up-1", attempts: 2 }],
    followUpsUsed: 1,
  },
  budget: {
    ...approved.budget,
    consumed: { ...approved.budget.consumed, branchAttempts: 3 },
    attemptsByBranch: { "branch-1": 1, "branch-2": 2 },
    openAllocations: [
      {
        workId: "branch-2-follow-up-1",
        branchId: "branch-2",
        attempt: 2,
        modelRounds: 12,
        searches: 10,
      },
    ],
  },
};

const gathered = [done!, { ...running!, state: "completed", finding: done!.finding }];
const hypothesis = {
  hypothesisId: "h-1",
  revision: 1,
  previousRevision: null,
  branchId: "branch-1",
  claim: "Moon drives tides",
  alternative: "Wind drives tides",
  prediction: "Lunar cycle",
  disconfirmation: "No lunar cycle",
  status: "untested",
  observationIds: [] as string[],
};
const literature = {
  testId: "t-1",
  hypothesisId: "h-1",
  hypothesisRevision: 1,
  kind: "literature-check",
  method: "Check tables",
  status: "proposed",
};
const supplied = {
  ...literature,
  testId: "t-2",
  kind: "supplied-observation",
  status: "awaiting-input",
};
const testWork = {
  ...running!,
  workId: "t-1",
  branchId: "branch-1",
  state: "pending",
  attempts: 0,
};
const sourceObservation = {
  observationId: "o-1",
  testId: "t-1",
  producer: "source",
  citationTokens: ["s1r1"],
  verdict: "supports",
  quote: "Tides follow the moon closely",
  limitations: [],
  observedAt: null,
  receivedAt: "2026-01-02T00:00:00.000Z",
};
const firstCycle = {
  ordinal: 1,
  workIds: ["w-1", "w-2"],
  decision: "continue",
  reason: "Gathered",
};
const proposedDiscovery = {
  hypotheses: [hypothesis],
  tests: [],
  observations: [],
  cycles: [firstCycle],
  notes: [],
  executions: [],
  omissions: [],
};
const discovering = {
  ...approved,
  phase: "discovering",
  executions: gathered,
  budget: { ...approved.budget, openAllocations: [] },
  discovery: proposedDiscovery,
};
const assessedDiscovery = {
  ...proposedDiscovery,
  hypotheses: [{ ...hypothesis, status: "supported", observationIds: ["o-1"] }],
  tests: [{ ...literature, status: "observed" }, supplied],
  observations: [sourceObservation],
  executions: [{ ...testWork, state: "completed", attempts: 1, finding: done!.finding }],
};
const assessedBudget = {
  ...discovering.budget,
  consumed: { ...approved.budget.consumed, branchAttempts: 3 },
  attemptsByBranch: { "branch-1": 2, "branch-2": 1 },
};

const userReport = {
  ...sourceObservation,
  observationId: "o-2",
  testId: "t-2",
  producer: "user",
  citationTokens: [],
  quote: null,
  verdict: "contradicts",
  limitations: ["reported, not independently checked"],
};
const observationPending = {
  decisionId: "decision-o",
  kind: "observation",
  artifactRevision: 1,
  subjectId: "t-2",
};

function discoveryStages(): unknown[] {
  const received = {
    ...assessedDiscovery,
    hypotheses: [{ ...hypothesis, status: "disconfirmed", observationIds: ["o-1", "o-2"] }],
    tests: [
      { ...literature, status: "observed" },
      { ...supplied, status: "observed" },
    ],
    observations: [sourceObservation, userReport],
  };
  const revised = {
    ...received,
    hypotheses: [...received.hypotheses, { ...hypothesis, revision: 2, previousRevision: 1 }],
  };
  const note = {
    sequence: 1,
    cycle: 2,
    attempted: "Checked tables",
    outcome: "Supported",
    citationTokens: ["s1r1"],
    decision: "continue",
    nextAction: "Revise",
  };
  return [
    discovering,
    {
      ...discovering,
      discovery: {
        ...proposedDiscovery,
        tests: [literature, supplied],
        executions: [testWork],
      },
    },
    {
      ...discovering,
      budget: {
        ...assessedBudget,
        openAllocations: [
          { workId: "t-1", branchId: "branch-1", attempt: 2, modelRounds: 12, searches: 10 },
        ],
      },
      discovery: {
        ...proposedDiscovery,
        tests: [literature, supplied],
        executions: [{ ...testWork, state: "running", attempts: 2 }],
      },
    },
    { ...discovering, budget: assessedBudget, discovery: assessedDiscovery },
    {
      ...discovering,
      phase: "awaiting-observation",
      pending: observationPending,
      budget: assessedBudget,
      discovery: assessedDiscovery,
    },
    { ...discovering, budget: assessedBudget, discovery: received },
    { ...discovering, budget: assessedBudget, discovery: revised },
    {
      ...discovering,
      budget: assessedBudget,
      discovery: {
        ...revised,
        cycles: [
          firstCycle,
          { ordinal: 2, workIds: ["t-1"], decision: "continue", reason: "Revised" },
        ],
        notes: [note],
      },
    },
  ];
}

function discoveryRows(): [string, unknown][] {
  const withDiscovery = (label: string, patch: object): [string, unknown] => [
    label,
    section({
      ...discovering,
      budget: assessedBudget,
      discovery: { ...assessedDiscovery, ...patch },
    }),
  ];
  const heavy = "\u0001".repeat(200);
  return [
    ["discovering without discovery", section({ ...discovering, discovery: null })],
    [
      "awaiting an observation no test needs",
      section({
        ...discovering,
        phase: "awaiting-observation",
        pending: observationPending,
        discovery: proposedDiscovery,
      }),
    ],
    [
      "observation decision without its test",
      section({
        ...discovering,
        phase: "awaiting-observation",
        pending: { ...observationPending, subjectId: undefined },
        budget: assessedBudget,
        discovery: assessedDiscovery,
      }),
    ],
    [
      "observation decision naming another test",
      section({
        ...discovering,
        phase: "awaiting-observation",
        pending: { ...observationPending, subjectId: "t-1" },
        budget: assessedBudget,
        discovery: assessedDiscovery,
      }),
    ],
    withDiscovery("status its observations do not give", {
      hypotheses: [{ ...hypothesis, status: "disconfirmed", observationIds: ["o-1"] }],
    }),
    withDiscovery("revision without its predecessor", {
      hypotheses: [{ ...hypothesis, revision: 2, previousRevision: 1 }],
      tests: [],
      observations: [],
      executions: [],
    }),
    withDiscovery("hypothesis without an alternative", {
      hypotheses: [
        { ...hypothesis, alternative: "", status: "supported", observationIds: ["o-1"] },
      ],
    }),
    withDiscovery("source observation of a supplied test", {
      observations: [{ ...sourceObservation, testId: "t-2" }],
    }),
    withDiscovery("supporting source observation without a quote", {
      observations: [{ ...sourceObservation, quote: null }],
    }),
    withDiscovery("supporting source observation without a token", {
      observations: [{ ...sourceObservation, citationTokens: [] }],
    }),
    withDiscovery("user observation with tokens", {
      tests: [
        { ...literature, status: "observed" },
        { ...supplied, status: "observed" },
      ],
      observations: [sourceObservation, { ...userReport, citationTokens: ["s1r1"] }],
      hypotheses: [{ ...hypothesis, status: "disconfirmed", observationIds: ["o-1", "o-2"] }],
    }),
    withDiscovery("user observation without its limitation", {
      tests: [
        { ...literature, status: "observed" },
        { ...supplied, status: "observed" },
      ],
      observations: [sourceObservation, { ...userReport, limitations: [] }],
      hypotheses: [{ ...hypothesis, status: "disconfirmed", observationIds: ["o-1", "o-2"] }],
    }),
    withDiscovery("test work reusing a gather work id", {
      executions: [{ ...assessedDiscovery.executions[0], workId: "w-1" }],
    }),
    withDiscovery("non-boolean skipped observations", { observationsSkipped: "yes" }),
    withDiscovery("cycle naming an unknown work", {
      cycles: [{ ...firstCycle, workIds: ["w-9"] }],
    }),
    withDiscovery("notes over fifty", {
      notes: Array.from({ length: 51 }, (_, index) => ({
        sequence: index,
        cycle: 1,
        attempted: "a",
        outcome: "o",
        citationTokens: [],
        decision: "d",
        nextAction: "n",
      })),
    }),
    withDiscovery("discovery over its encoded size", {
      notes: Array.from({ length: 50 }, (_, index) => ({
        sequence: index,
        cycle: 1,
        attempted: heavy.slice(0, 80),
        outcome: heavy.slice(0, 80),
        citationTokens: [],
        decision: heavy.slice(0, 80),
        nextAction: heavy.slice(0, 80),
      })),
      omissions: Array.from({ length: 8 }, () => heavy),
      hypotheses: [
        { ...hypothesis, status: "supported", observationIds: ["o-1"] },
        ...Array.from({ length: 9 }, (_, index) => ({
          ...hypothesis,
          hypothesisId: `h-${index + 2}`,
          claim: heavy,
          alternative: heavy,
          prediction: heavy,
          disconfirmation: heavy,
        })),
      ],
    }),
  ];
}

function tokens(count: number, length: number): string[] {
  return Array.from({ length: count }, (_, index) => `${index}`.padStart(length, "t"));
}

function budgetRows(): [string, unknown][] {
  const budget = approved.budget;
  const withBudget = (label: string, patch: Partial<typeof budget>): [string, unknown] => [
    label,
    section({ ...approved, budget: { ...budget, ...patch } }),
  ];
  return [
    withBudget("fractional active time", { activeMs: 1.5 }),
    withBudget("NaN active time", { activeMs: Number.NaN }),
    withBudget("attempt total off the branch counts", {
      consumed: { ...budget.consumed, branchAttempts: 3 },
    }),
    withBudget("branch count below its execution attempts", {
      attemptsByBranch: { "branch-1": 0, "branch-2": 2 },
    }),
    withBudget("branch count over its cap", {
      consumed: { ...budget.consumed, branchAttempts: 6 },
      attemptsByBranch: { "branch-1": 5, "branch-2": 1 },
    }),
    withBudget("rounds over the limit with the open allocation", {
      consumed: { ...budget.consumed, modelRounds: 270 },
    }),
    withBudget("searches over the limit with the open allocation", {
      consumed: { ...budget.consumed, searches: 95 },
    }),
    withBudget("closure the owner never writes", {
      openAllocations: [],
      closed: { reason: "user", dimension: null },
    }),
  ];
}

function sessionRows(): [string, unknown][] {
  const ref = { sessionId: "session-1", runId: "run-1", resultRevision: 2 };
  const child = { ...done!, path: "sub-agent", runRef: ref };
  const withSessions = (label: string, patch: object): [string, unknown] => [
    label,
    section({ ...approved, sessionByBranch: { "branch-1": "session-1" }, ...patch }),
  ];
  return [
    withSessions("session of an unplanned branch", { sessionByBranch: { x: "session-1" } }),
    withSessions("one session for two branches", {
      sessionByBranch: { "branch-1": "session-1", "branch-2": "session-1" },
    }),
    withSessions("sessions over the ceiling", {
      plan: { ...approved.plan, limits: { ...approved.plan.limits, childSessions: 1 } },
      sessionByBranch: { "branch-1": "session-1", "branch-2": "session-2" },
    }),
    ["session before approval", section({ ...pending, sessionByBranch: { "branch-1": "s-1" } })],
    withSessions("malformed session id", { sessionByBranch: { "branch-1": 7 } }),
    withSessions("run ref on the main path", { executions: [{ ...child, path: "main" }, running] }),
    withSessions("run ref of another session", {
      executions: [{ ...child, runRef: { ...ref, sessionId: "session-2" } }, running],
    }),
    withSessions("malformed run ref", {
      executions: [{ ...child, runRef: { ...ref, resultRevision: -1 } }, running],
    }),
  ];
}

function briefAndVerificationRows(): [string, unknown][] {
  const brief = clarifying.brief;
  const verification = verifying.verification;
  const withVerification = (label: string, patch: object): [string, unknown] => [
    label,
    section({ ...verifying, verification: { ...verification, ...patch } }),
  ];
  return [
    [
      "clarification without questions",
      section({ ...clarifying, brief: { ...brief, questions: [] } }),
    ],
    ["clarification with a plan", section({ ...clarifying, plan: pending.plan })],
    [
      "answer to an unasked question",
      section({ ...pending, brief: { ...brief, answers: { "question-9": "Yes" } } }),
    ],
    [
      "four questions",
      section({
        ...pending,
        brief: {
          ...brief,
          questions: [1, 2, 3, 4].map((n) => ({
            ...brief.questions[0],
            questionId: `question-${n}`,
          })),
        },
      }),
    ],
    ["verification before approval", section({ ...pending, verification })],
    withVerification("claim of an unplanned branch", { claims: [{ ...claim, branchId: "x" }] }),
    withVerification("claim of an unknown kind", { claims: [{ ...claim, kind: "guess" }] }),
    withVerification("claim of an unknown work", { claims: [{ ...claim, workId: "w-9" }] }),
    withVerification("claim of an unplanned objective", { claims: [{ ...claim, objective: "Z" }] }),
    withVerification("assessment of an unknown claim", {
      assessments: [{ ...verification.assessments[0], claimId: "c-x" }],
    }),
    withVerification("unknown verdict", {
      assessments: [{ ...verification.assessments[0], verdict: "plausible" }],
    }),
    withVerification("over-long claim", { claims: [{ ...claim, text: "x".repeat(1001) }] }),
    withVerification("follow-ups over the cap", { followUpsUsed: 3 }),
    withVerification("supported without a quote", {
      assessments: [{ ...verification.assessments[0], quote: null }],
    }),
    withVerification("quote on an unresolved claim", {
      assessments: [{ ...verification.assessments[0], verdict: "unresolved" }],
      coverage: [{ objective: "Objective", covered: false }],
    }),
    withVerification("claim assessed twice", {
      assessments: [verification.assessments[0], verification.assessments[0]],
    }),
    withVerification("verified work that does not exist", { verifiedWorks: ["w-1", "w-9"] }),
    withVerification("coverage the claims do not give", {
      coverage: [{ objective: "Objective", covered: false }],
    }),
    [
      "objective the claim's branch does not serve",
      section({
        ...verifying,
        plan: {
          ...verifying.plan,
          branches: [verifying.plan.branches[0], { ...verifying.plan.branches[1], objectives: [] }],
        },
        verification: { ...verification, claims: [{ ...claim, branchId: "branch-2" }] },
      }),
    ],
    withVerification("follow-up allocation without its execution", { followUps: [] }),
  ];
}

function section(active: unknown, history: unknown[] = []) {
  return { schema: 1, active, history };
}

describe("deep research section validation", () => {
  it("rejects malformed and inconsistent sections as unreadable", () => {
    const rows: [string, unknown][] = [
      ["unknown schema", { ...section(pending), schema: 2 }],
      ["unsafe revision", section({ ...pending, revision: 2 ** 53 })],
      ["negative revision", section({ ...pending, revision: -1 })],
      ["fractional revision", section({ ...pending, revision: 1.5 })],
      ["unknown phase", section({ ...pending, phase: "dreaming", pending: null })],
      ["inner schema", section({ ...pending, schema: 2 })],
      ["terminal phase as active", section({ ...pending, phase: "completed", pending: null })],
      [
        "history over ten",
        section(
          null,
          Array.from({ length: 11 }, () => ended),
        ),
      ],
      [
        "limits off preset",
        section({
          ...pending,
          plan: { ...pending.plan!, limits: { ...presetLimits("thorough"), searchesTotal: 999 } },
        }),
      ],
      ["decision in planning", section({ ...pending, phase: "planning" })],
      ["plan decision without plan", section({ ...pending, plan: null })],
      [
        "artifact revision off plan",
        section({ ...pending, pending: { ...pending.pending!, artifactRevision: 7 } }),
      ],
      [
        "approved while awaiting",
        section({ ...pending, plan: { ...pending.plan!, approvedAt: "2026-01-02T00:00:00.000Z" } }),
      ],
      ["gathering without approval", section({ ...approved, plan: pending.plan })],
      [
        "unbounded timestamp",
        section({
          ...pending,
          createdAt: "Thursday, January 1, 2026 00:00:00 GMT+0000 (Coordinated Universal Time)",
        }),
      ],
      ["non-terminal phase in history", section(null, [{ ...ended, phase: "gathering" }])],
      ["bad timestamp in history", section(null, [{ ...ended, updatedAt: "yesterday" }])],
      ["over-long history reason", section(null, [{ ...ended, terminalReason: "r".repeat(4001) }])],
      [
        "over-long missing branch title",
        section(null, [
          {
            ...ended,
            report: {
              ...ended.report,
              missingBranches: [{ branchId: "branch-2", reason: "Time", title: "t".repeat(4001) }],
            },
          },
        ]),
      ],
      [
        "summary failure that is not text",
        section(null, [{ ...ended, report: { ...ended.report, summaryFailure: 42 } }]),
      ],
      [
        "report scale above the objective bound",
        section(null, [
          {
            ...ended,
            report: { ...ended.report, scale: { objectives: 13, activeMs: 0, activeLimitMs: 0 } },
          },
        ]),
      ],
      [
        "report stats with a negative counter",
        section(null, [
          { ...ended, report: { ...ended.report, stats: { ...reportStats, sourcesFound: -1 } } },
        ]),
      ],
      [
        "report stats naming an uncited branch without a valid id",
        section(null, [
          {
            ...ended,
            report: {
              ...ended.report,
              stats: { ...reportStats, uncitedBranches: [{ branchId: "no id!", title: "T" }] },
            },
          },
        ]),
      ],
      [
        "covered objectives above the objective bound",
        section(null, [
          {
            ...ended,
            report: {
              ...ended.report,
              verification: { ...ended.report.verification, coveredObjectives: 13 },
            },
          },
        ]),
      ],
      [
        "too many objectives",
        section({
          ...pending,
          plan: researchPlan(undefined, "thorough", {
            objectives: Array.from({ length: 13 }, (_, i) => `O${i}`),
          }),
        }),
      ],
      [
        "execution of unknown branch",
        section({ ...approved, executions: [{ ...done, branchId: "x" }] }),
      ],
      [
        "completed without finding",
        section({ ...approved, executions: [{ ...done, finding: null }, running] }),
      ],
      [
        "duplicate work id",
        section({ ...approved, executions: [done, { ...running, workId: "w-1" }] }),
      ],
      ["executions before approval", section({ ...pending, executions: [running] })],
      [
        "finding over the bound",
        section({
          ...approved,
          executions: [
            { ...done, finding: { ...done!.finding!, text: "x".repeat(30_001) } },
            running,
          ],
        }),
      ],
      ["open allocation without running work", section({ ...approved, executions: [done] })],
      [
        "unknown closure reason",
        section({
          ...approved,
          budget: { ...approved.budget, closed: { reason: "bored", dimension: null } },
        }),
      ],
      [
        "negative consumption",
        section({
          ...approved,
          budget: { ...approved.budget, consumed: { ...approved.budget.consumed, searches: -1 } },
        }),
      ],
      ...budgetRows(),
      ...sessionRows(),
      ...briefAndVerificationRows(),
      ...discoveryRows(),
      [
        "more tokens than the bound",
        section({
          ...approved,
          executions: [
            { ...done, finding: { ...done!.finding!, citationTokens: tokens(201, 8) } },
            running,
          ],
        }),
      ],
      [
        "over-long token",
        section({
          ...approved,
          executions: [
            { ...done, finding: { ...done!.finding!, citationTokens: tokens(1, 201) } },
            running,
          ],
        }),
      ],
      [
        "finding over the encoded size",
        section({
          ...approved,
          executions: [
            { ...done, finding: { ...done!.finding!, text: "\u0001".repeat(10_000) } },
            running,
          ],
        }),
      ],
      ["report in an active research", section({ ...approved, report: ended.report })],
      [
        "malformed history report",
        section(null, [{ ...ended, report: { ...ended.report, quality: "great" } }]),
      ],
    ];
    for (const [label, value] of rows) {
      expect(validateResearchSection(value).ok, label).toBe(false);
    }
  });

  it("accepts consistent sections and drops unknown keys", () => {
    const scaled = {
      ...ended,
      report: {
        ...ended.report,
        missingBranches: [{ branchId: "branch-2", reason: "Time", title: "Tides" }],
        scale: { objectives: 12, activeMs: 1_000, activeLimitMs: 2_000 },
        stats: reportStats,
        summaryFailure: "The report came back empty.",
        verification: { ...ended.report.verification, coveredObjectives: 12 },
      },
    };
    const rebuilt = validateResearchSection(section(approved, [scaled]));
    expect(rebuilt.ok && rebuilt.value).toEqual(section(approved, [scaled]));
    const wave = {
      ...approved,
      sessionByBranch: { "branch-1": "session-1" },
      executions: [
        {
          ...done!,
          path: "sub-agent",
          runRef: { sessionId: "session-1", runId: "run-1", resultRevision: 2 },
        },
        running,
      ],
      budget: { ...approved.budget, closed: { reason: "time", dimension: null } },
    };
    const grown = {
      ...approved,
      plan: researchPlan(
        Array.from({ length: 10 }, (_, index) => researchBranch(index + 1)),
        "thorough",
        { approvedAt: approved.plan.approvedAt },
      ),
      budget: { ...approved.budget, consumed: { ...approved.budget.consumed, modelRounds: 300 } },
      sessionByBranch: Object.fromEntries(
        Array.from({ length: 7 }, (_, index) => [`branch-${index + 1}`, `session-${index + 1}`]),
      ),
    };
    expect(validateResearchSection(section(grown)).ok).toBe(true);
    const midWave = validateResearchSection(section(wave));
    expect(midWave.ok && midWave.value).toEqual(section(wave));
    const legacy = { ...approved } as Partial<typeof approved>;
    delete (legacy as { sessionByBranch?: unknown }).sessionByBranch;
    delete (legacy as { brief?: unknown }).brief;
    delete (legacy as { verification?: unknown }).verification;
    expect(validateResearchSection(section(legacy)).ok).toBe(true);
    const { verification: _counts, ...legacyReport } = ended.report;
    expect(validateResearchSection(section(null, [{ ...ended, report: legacyReport }])).ok).toBe(
      true,
    );
    for (const state of discoveryStages()) {
      const read = validateResearchSection(section(state));
      expect(read.ok && read.value).toEqual(section(state));
    }
    for (const state of [clarifying, verifying]) {
      const read = validateResearchSection(section(state));
      expect(read.ok && read.value, state.phase).toEqual(section(state));
    }
    const result = validateResearchSection({
      ...section({ ...pending, extra: 1, plan: { ...pending.plan!, extra: 2 } }, [
        { ...ended, extra: 3 },
      ]),
      extra: 4,
    });
    expect(result.ok && JSON.stringify(result.value)).not.toContain("extra");
  });
});
