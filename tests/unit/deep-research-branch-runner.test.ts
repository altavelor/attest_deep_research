import { unreadWebSources } from "@application/use-cases/research/deep-research/branchRunner";
import { retrieved, webSource } from "../support/factories";

describe("unread web sources of a branch", () => {
  it("keeps at most five distinct addresses within the length bound and drops opened pages", () => {
    const page = (id: string, url: string) => retrieved(id, webSource(url), "Body");
    const evidence = [
      page("opened", "https://e.test/opened"),
      page("long", `https://e.test/${"x".repeat(500)}`),
      ...Array.from({ length: 7 }, (_, index) => page(`p-${index}`, `https://e.test/${index}`)),
      page("again", "https://e.test/0"),
    ];
    const urls = unreadWebSources(
      {
        evidence,
        citations: [],
        provenance: [{ evidenceId: "opened", calls: [{ callId: "c", tool: "fetch_web_page" }] }],
      },
      new Set(),
    );
    expect(urls).toEqual([0, 1, 2, 3, 4].map((index) => `https://e.test/${index}`));
  });
});
