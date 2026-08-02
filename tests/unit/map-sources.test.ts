import { MapSources } from "@application/use-cases/map-sources";
import {
  buildSourceTask,
  citedEvidenceIds,
  parseSourceAnswer,
} from "@application/use-cases/map-sources";
import type { SubAgentPort, SubAgentRunInput, SubAgentRunResult } from "@application/research";
import type { ResearchRetriever } from "@application/contracts/research";
import type { RetrievedChunk } from "@core/model";
import type { ResearchEvidenceSnapshot } from "@application/sources/evidence";

function chunk(id: string, path: string): RetrievedChunk {
  return {
    id,
    text: `text of ${id}`,
    contentHash: id,
    score: 1,
    source: { id: path, kind: "pdf", title: path, path, pageNumber: 1 },
  };
}

function snapshot(chunks: RetrievedChunk[]): ResearchEvidenceSnapshot {
  return { evidence: chunks, citations: [], provenance: [] };
}

const emptyContext = {
  availability: {
    searchMode: "indexAndWeb" as const,
    noteAccess: true,
    activeFileAccess: false,
    retrieverAvailable: true,
    webProviderAvailable: true,
    noteMutationAccess: false,
  },
};

describe("map-sources parsing", () => {
  it("extracts stance and findings, tolerating case and bullet markers", () => {
    const answer = [
      "- The paper argues the effect is real [e1].",
      "* A caveat about sample size [e2].",
      "stance: SUPPORTS",
    ].join("\n");
    const parsed = parseSourceAnswer(answer);
    expect(parsed.stance).toBe("supports");
    expect(parsed.keyFindings).toEqual([
      "The paper argues the effect is real [e1].",
      "A caveat about sample size [e2].",
    ]);
  });

  it("defaults to unclear when no stance line is present", () => {
    expect(parseSourceAnswer("Some finding.").stance).toBe("unclear");
  });

  it("cites only evidence ids that appear in the answer, else the whole snapshot", () => {
    const snap = snapshot([chunk("e1", "a.pdf"), chunk("e2", "a.pdf")]);
    expect(citedEvidenceIds("relies on [e2] only", snap)).toEqual(["e2"]);
    expect(citedEvidenceIds("no citations here", snap)).toEqual(["e1", "e2"]);
  });

  it("scopes the task to one document path", () => {
    const task = buildSourceTask("Does X hold?", "papers/a.pdf");
    expect(task).toContain("papers/a.pdf");
    expect(task).toContain("STANCE:");
  });
});

describe("MapSources fan-out", () => {
  it("selects sources by relevance when none are given and scopes each sub-agent", async () => {
    const seen: SubAgentRunInput[] = [];
    const runner: SubAgentPort = {
      run: async (input): Promise<SubAgentRunResult> => {
        seen.push(input);
        const path = /"([^"]+\.pdf)"/.exec(input.task)?.[1] ?? "?";
        return {
          answerText: `Finding for ${path} [c-${path}]\nSTANCE: SUPPORTS`,
          snapshot: snapshot([chunk(`c-${path}`, path)]),
        };
      },
    };
    const retriever = {
      search: vi.fn().mockResolvedValue({
        chunks: [chunk("x", "a.pdf"), chunk("y", "a.pdf"), chunk("z", "b.pdf")],
        citations: [],
        usedFallback: false,
      }),
    } as unknown as ResearchRetriever;

    const mapper = new MapSources({ runner, retriever, toolContext: emptyContext });
    const result = await mapper.run({ question: "Does X hold?" });

    expect(result.diagnostics.selection).toBe("relevance");

    expect(result.rows.map((row) => row.sourcePath)).toEqual(["a.pdf", "b.pdf"]);
    expect(result.rows.every((row) => row.ok && row.stance === "supports")).toBe(true);
    expect(result.diagnostics.completed).toBe(2);

    for (const input of seen) {
      expect(input.toolContext?.availability.searchMode).toBe("indexOnly");
      expect(input.toolContext?.availability.noteAccess).toBe(false);
      expect(input.toolContext?.subAgentRunner).toBeUndefined();
      expect(input.toolContext?.indexSourcePaths).toHaveLength(1);
      expect(input.budget?.maxRounds).toBeGreaterThan(0);
    }
  });

  it("uses explicit sourcePaths and does not call the retriever", async () => {
    const runner: SubAgentPort = {
      run: async () => ({ answerText: "STANCE: MIXED", snapshot: snapshot([]) }),
    };
    const retriever = { search: vi.fn() } as unknown as ResearchRetriever;

    const mapper = new MapSources({ runner, retriever, toolContext: emptyContext });
    const result = await mapper.run({
      question: "compare",
      sourcePaths: ["a.pdf", "b.pdf", "a.pdf"],
    });

    expect(retriever.search).not.toHaveBeenCalled();
    expect(result.diagnostics.selection).toBe("explicit");
    expect(result.rows.map((row) => row.sourcePath)).toEqual(["a.pdf", "b.pdf"]);
  });

  it("degrades one failing sub-agent to an error row without failing the run", async () => {
    const runner: SubAgentPort = {
      run: async (input) => {
        if (input.task.includes("b.pdf")) {
          throw new Error("boom");
        }
        return {
          answerText: "ok [c1]\nSTANCE: SUPPORTS",
          snapshot: snapshot([chunk("c1", "a.pdf")]),
        };
      },
    };
    const retriever = { search: vi.fn() } as unknown as ResearchRetriever;

    const mapper = new MapSources({ runner, retriever, toolContext: emptyContext });
    const result = await mapper.run({ question: "q", sourcePaths: ["a.pdf", "b.pdf"] });

    const failed = result.rows.find((row) => row.sourcePath === "b.pdf");
    expect(failed?.ok).toBe(false);
    expect(failed?.error).toContain("boom");
    expect(result.diagnostics.completed).toBe(1);
    expect(result.diagnostics.failed).toBe(1);
  });

  it("bounds concurrent sub-agents to maxParallel", async () => {
    let active = 0;
    let peak = 0;
    const runner: SubAgentPort = {
      run: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { answerText: "STANCE: SUPPORTS", snapshot: snapshot([]) };
      },
    };
    const retriever = { search: vi.fn() } as unknown as ResearchRetriever;

    const mapper = new MapSources({
      runner,
      retriever,
      toolContext: emptyContext,
      maxParallel: 2,
    });
    await mapper.run({
      question: "q",
      sourcePaths: ["a.pdf", "b.pdf", "c.pdf", "d.pdf", "e.pdf"],
    });
    expect(peak).toBeLessThanOrEqual(2);
  });
});
