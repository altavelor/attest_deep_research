import { HttpWebSearchSource, WEB_SOURCE_DEFINITIONS } from "@adapters/web";

interface PayloadShape {
  wrap: (results: unknown) => unknown;
  complete: Record<string, unknown>;
  required: string[];
  extractedTextField?: string;
}

const CREDENTIALS: Record<string, string> = {
  apiKey: "test-key",
  engineId: "test-cx",
  baseUrl: "https://searx.example.org",
};

const SHAPES: Record<string, PayloadShape> = {
  brave: {
    wrap: (results) => ({ web: { results } }),
    complete: { title: "Hit", url: "https://a.dev/", description: "desc" },
    required: ["title", "url"],
  },
  "google-cse": {
    wrap: (items) => ({ items }),
    complete: { title: "Hit", link: "https://a.dev/", snippet: "desc" },
    required: ["title", "link"],
  },
  serper: {
    wrap: (organic) => ({ organic }),
    complete: { title: "Hit", link: "https://a.dev/", snippet: "desc" },
    required: ["title", "link"],
  },
  searxng: {
    wrap: (results) => ({ results }),
    complete: { title: "Hit", url: "https://a.dev/", content: "desc" },
    required: ["title", "url"],
  },
  tavily: {
    wrap: (results) => ({ results }),
    complete: { title: "Hit", url: "https://a.dev/", content: "full text" },
    required: ["title", "url"],
    extractedTextField: "content",
  },
  exa: {
    wrap: (results) => ({ results }),
    complete: { title: "Hit", url: "https://a.dev/", text: "full text" },
    required: ["title", "url"],
    extractedTextField: "text",
  },
  jina: {
    wrap: (data) => ({ data }),
    complete: { title: "Hit", url: "https://a.dev/", description: "desc", content: "full text" },
    required: ["title", "url"],
    extractedTextField: "content",
  },
  firecrawl: {
    wrap: (data) => ({ data }),
    complete: { title: "Hit", url: "https://a.dev/", description: "desc", markdown: "full text" },
    required: ["title", "url"],
    extractedTextField: "markdown",
  },
};

function response(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

function sourceFor(id: string, fetchMock: typeof fetch): HttpWebSearchSource {
  const definition = WEB_SOURCE_DEFINITIONS.find((entry) => entry.descriptor.id === id);
  if (!definition) throw new Error(`No definition: ${id}`);
  return new HttpWebSearchSource(definition, { credentials: CREDENTIALS, fetch: fetchMock });
}

describe("web search requests with absent configuration", () => {
  for (const id of Object.keys(SHAPES)) {
    it(`${id}: builds a request for every recency window without credentials`, () => {
      const definition = WEB_SOURCE_DEFINITIONS.find((entry) => entry.descriptor.id === id)!;

      for (const recency of [undefined, "day", "week", "month"] as const) {
        const request = definition.buildRequest({
          query: "obsidian plugins",
          limit: 5,
          credentials: {},
          ...(recency ? { recency } : {}),
        });

        expect(JSON.stringify(request)).not.toContain("undefined");
        expect(`${request.url}${request.body ?? ""}`).toContain("obsidian");
      }
    });
  }
});

describe("untrusted web search payloads", () => {
  for (const [id, shape] of Object.entries(SHAPES)) {
    describe(id, () => {
      it("maps HTTP 429 and 5xx to a failure with the reason and status", async () => {
        for (const [status, reason] of [
          [429, "rate-limited"],
          [500, "http"],
          [503, "http"],
        ] as const) {
          const fetchMock = vi.fn().mockResolvedValue(response("{}", status));
          await expect(
            sourceFor(id, fetchMock as unknown as typeof fetch).search("obsidian plugins"),
          ).rejects.toMatchObject({
            code: "WEB_SEARCH_FAILED",
            details: { sourceId: id, reason, status },
          });
        }
      });

      it("rejects a truncated body as bad-response instead of parsing a partial payload", async () => {
        const truncated = JSON.stringify(shape.wrap([shape.complete])).slice(0, -6);
        const fetchMock = vi.fn().mockResolvedValue(response(truncated));

        await expect(
          sourceFor(id, fetchMock as unknown as typeof fetch).search("obsidian plugins"),
        ).rejects.toMatchObject({ details: { sourceId: id, reason: "bad-response" } });
      });

      it("returns no results for JSON of the wrong shape", async () => {
        for (const body of ["null", '"a string"', "[1,2,3]", JSON.stringify(shape.wrap({}))]) {
          const fetchMock = vi.fn().mockResolvedValue(response(body));
          await expect(
            sourceFor(id, fetchMock as unknown as typeof fetch).search("obsidian plugins"),
          ).resolves.toEqual([]);
        }
      });

      it("returns no results for an empty result array", async () => {
        const fetchMock = vi.fn().mockResolvedValue(response(JSON.stringify(shape.wrap([]))));
        await expect(
          sourceFor(id, fetchMock as unknown as typeof fetch).search("obsidian plugins"),
        ).resolves.toEqual([]);
      });

      it("drops entries missing a required field and keeps the valid ones", async () => {
        const broken = shape.required.map((field) => {
          const entry: Record<string, unknown> = { ...shape.complete };
          delete entry[field];
          return entry;
        });
        broken.push({ ...shape.complete, [shape.required[1]!]: "/relative" });
        broken.push({ ...shape.complete, [shape.required[0]!]: 42 });
        broken.push(null as unknown as Record<string, unknown>);

        const fetchMock = vi
          .fn()
          .mockResolvedValue(response(JSON.stringify(shape.wrap([...broken, shape.complete]))));
        const results = await sourceFor(id, fetchMock as unknown as typeof fetch).search(
          "obsidian plugins",
        );

        expect(results).toHaveLength(1);
        expect(results[0]!.source.url).toBe("https://a.dev/");
      });

      if (shape.extractedTextField) {
        it("omits extracted text when the provider leaves the content field out", async () => {
          const entry: Record<string, unknown> = { ...shape.complete };
          delete entry[shape.extractedTextField!];
          const fetchMock = vi
            .fn()
            .mockResolvedValue(response(JSON.stringify(shape.wrap([entry]))));

          const [result] = await sourceFor(id, fetchMock as unknown as typeof fetch).search(
            "obsidian plugins",
          );
          expect(result!.extractedText).toBeUndefined();
          expect(result!.source.wasContentFetched).toBe(false);
        });
      }
    });
  }
});
