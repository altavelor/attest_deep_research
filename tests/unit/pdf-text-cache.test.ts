import { describe, expect, it } from "vitest";

import { PdfTextCache } from "@adapters/extractors";

describe("PdfTextCache", () => {
  it("returns an immutable cache hit only for the matching file fingerprint", () => {
    const cache = new PdfTextCache();
    const content = [{ pageNumber: 1, text: "Original text" }];
    const headings = [{ level: 1, title: "Introduction", pageNumber: 1 }];

    const stored = cache.set("Papers/report.pdf", { mtime: 10, size: 100 }, content, headings);
    stored.content[0]!.text = "Mutated caller copy";
    stored.headings![0]!.title = "Mutated heading";

    const hit = cache.get("Papers/report.pdf", { mtime: 10, size: 100 });
    expect(hit).toMatchObject({
      content: [{ pageNumber: 1, text: "Original text" }],
      headings: [{ title: "Introduction" }],
    });
    expect(cache.get("Papers/report.pdf", { mtime: 11, size: 100 })).toBeNull();
    expect(cache.get("Papers/report.pdf", { mtime: 10, size: 101 })).toBeNull();
    expect(cache.get("Papers/missing.pdf", { mtime: 10, size: 100 })).toBeNull();
  });

  it("omits empty headings and clears one entry or the full cache", () => {
    const cache = new PdfTextCache();
    cache.set("Papers/one.pdf", { mtime: 1, size: 1 }, [{ pageNumber: 1, text: "One" }], []);
    cache.set("Papers/two.pdf", { mtime: 1, size: 1 }, [{ pageNumber: 1, text: "Two" }]);

    expect(cache.get("Papers/one.pdf", { mtime: 1, size: 1 })?.headings).toBeUndefined();
    cache.clear("Papers/one.pdf");
    expect(cache.get("Papers/one.pdf", { mtime: 1, size: 1 })).toBeNull();
    expect(cache.get("Papers/two.pdf", { mtime: 1, size: 1 })).not.toBeNull();
    cache.clear();
    expect(cache.get("Papers/two.pdf", { mtime: 1, size: 1 })).toBeNull();
  });
});
