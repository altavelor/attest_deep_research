import { groupClaims } from "@application/use-cases/claims";
import { parseExtractedClaims } from "@adapters/indexing";
import { parseClaimsFile, serializeClaimsFile } from "@adapters/indexing";
import type { DocumentClaim, SourceDocumentClaims } from "@application/ports";

function claim(
  overrides: Partial<DocumentClaim> & Pick<DocumentClaim, "sourcePath" | "subject" | "statement">,
): DocumentClaim {
  return {
    claimId: overrides.claimId ?? `${overrides.sourcePath}:${overrides.subject}`,
    chunkId: overrides.chunkId ?? `${overrides.sourcePath}#c`,
    topicKeys: overrides.topicKeys ?? [],
    ...overrides,
  };
}

function source(sourcePath: string, claims: DocumentClaim[]): SourceDocumentClaims {
  return {
    schemaVersion: 1,
    sourcePath,
    contentHash: "h",
    claims,
    generation: { model: "m", promptVersion: 1, generatedAt: "2026-01-01T00:00:00Z" },
  };
}

describe("groupClaims", () => {
  it("groups by subject and puts multi-document subjects first", () => {
    const sources = [
      source("a.pdf", [
        claim({ sourcePath: "a.pdf", subject: "mail forwarding", statement: "A forwards mail." }),
        claim({ sourcePath: "a.pdf", subject: "solo topic", statement: "A says solo." }),
      ]),
      source("b.pdf", [
        claim({ sourcePath: "b.pdf", subject: "Mail Forwarding", statement: "B blocks mail." }),
      ]),
    ];

    const groups = groupClaims(sources, { limit: 50 });
    // "mail forwarding" is covered by both documents → first.
    expect(groups[0].subject.toLowerCase()).toBe("mail forwarding");
    expect(groups[0].sourcePaths.sort()).toEqual(["a.pdf", "b.pdf"]);
    expect(groups[0].claims).toHaveLength(2);
    // Single-document subject still present, but ranked lower.
    expect(groups.some((group) => group.subject === "solo topic")).toBe(true);
  });

  it("filters by subject and topic query", () => {
    const sources = [
      source("a.pdf", [
        claim({
          sourcePath: "a.pdf",
          subject: "privacy",
          statement: "Mail is private.",
          topicKeys: ["privacy.mail"],
        }),
        claim({ sourcePath: "a.pdf", subject: "weather", statement: "It rains." }),
      ]),
    ];

    expect(groupClaims(sources, { subject: "privacy", limit: 50 })).toHaveLength(1);
    expect(groupClaims(sources, { topic: "privacy.mail", limit: 50 })[0].subject).toBe("privacy");
    expect(groupClaims(sources, { subject: "nonexistent", limit: 50 })).toHaveLength(0);
  });

  it("bounds the total number of claims returned across groups", () => {
    const many = source(
      "a.pdf",
      Array.from({ length: 10 }, (_, index) =>
        claim({ sourcePath: "a.pdf", subject: `s${index}`, statement: `claim ${index}` }),
      ),
    );
    const total = groupClaims([many], { limit: 3 }).reduce(
      (sum, group) => sum + group.claims.length,
      0,
    );
    expect(total).toBe(3);
  });

  it("co-locates contradictory claims about the same subject (contradiction precondition)", () => {
    // ~synthetic pairs: same subject with opposing statements must land together so
    // the judge can compare them; unrelated subjects must not be merged.
    const pairs: Array<[string, string, string]> = [
      ["caffeine half-life", "Caffeine half-life is 5 hours.", "Caffeine half-life is 10 hours."],
      ["earth age", "The earth is 4.5 billion years old.", "The earth is 6000 years old."],
      ["speed limit", "The limit is 60.", "The limit is 90."],
    ];
    const sources = pairs.flatMap(([subject, a, b], index) => [
      source(`a${index}.pdf`, [claim({ sourcePath: `a${index}.pdf`, subject, statement: a })]),
      source(`b${index}.pdf`, [claim({ sourcePath: `b${index}.pdf`, subject, statement: b })]),
    ]);

    for (const [subject] of pairs) {
      const groups = groupClaims(sources, { subject, limit: 50 });
      const group = groups.find((candidate) => candidate.subject === subject);
      expect(group?.sourcePaths).toHaveLength(2);
      expect(group?.claims).toHaveLength(2);
    }
  });
});

describe("parseExtractedClaims", () => {
  it("parses a strict JSON array and normalizes fields", () => {
    const claims = parseExtractedClaims(
      '[{"subject":"Mail Forwarding","statement":"Mail is forwarded.","topicKeys":["Privacy.Mail","x"]}]',
    );
    expect(claims).toEqual([
      {
        subject: "mail forwarding",
        statement: "Mail is forwarded.",
        topicKeys: ["privacy.mail", "x"],
      },
    ]);
  });

  it("tolerates prose around the array and drops invalid items", () => {
    const claims = parseExtractedClaims(
      'Here you go:\n[{"subject":"a","statement":"S."},{"statement":"no subject"},{"subject":"b","statement":"T."}]\nDone.',
    );
    expect(claims.map((c) => c.subject)).toEqual(["a", "b"]);
  });

  it("returns [] when there is no array", () => {
    expect(parseExtractedClaims("no claims here")).toEqual([]);
  });
});

describe("claims JSONL sidecar", () => {
  it("round-trips header + claim lines", () => {
    const claims = source("papers/a.pdf", [
      claim({ sourcePath: "papers/a.pdf", subject: "x", statement: "X.", topicKeys: ["t"] }),
      claim({ sourcePath: "papers/a.pdf", subject: "y", statement: "Y." }),
    ]);
    const serialized = serializeClaimsFile(claims);
    // One header line + two claim lines.
    expect(serialized.split("\n")).toHaveLength(3);
    expect(parseClaimsFile(serialized)).toEqual(claims);
  });

  it("returns null for an empty or headerless file and skips malformed claim lines", () => {
    expect(parseClaimsFile("")).toBeNull();
    const header =
      '{"schemaVersion":1,"sourcePath":"a.pdf","contentHash":"h","generation":{"model":"m","promptVersion":1,"generatedAt":"t"}}';
    const parsed = parseClaimsFile(
      `${header}\nnot-json\n{"claimId":"1","chunkId":"c","sourcePath":"a.pdf","subject":"s","statement":"S.","topicKeys":[]}`,
    );
    expect(parsed?.claims).toHaveLength(1);
  });
});
