import { extractPageMetadata } from "@adapters/web";

describe("extractPageMetadata", () => {
  it("prefers Open Graph values and parses author/published/canonical/lang", () => {
    const html = `
      <html lang="en-US">
      <head>
        <title>Fallback Title</title>
        <meta property="og:title" content="OG Title" />
        <meta property="og:site_name" content="Example News" />
        <meta name="description" content="A short summary." />
        <meta name="author" content="Jane Doe" />
        <meta property="article:published_time" content="2024-05-01T10:00:00Z" />
        <link rel="canonical" href="https://example.com/canonical" />
      </head>
      <body>ignored</body></html>`;

    expect(extractPageMetadata(html)).toEqual({
      title: "OG Title",
      description: "A short summary.",
      siteName: "Example News",
      author: "Jane Doe",
      publishedTime: "2024-05-01T10:00:00Z",
      language: "en-US",
      canonicalUrl: "https://example.com/canonical",
    });
  });

  it("falls back to <title> and omits absent fields", () => {
    const html = "<head><title>Only Title</title></head>";
    expect(extractPageMetadata(html)).toEqual({ title: "Only Title" });
  });

  it("returns an empty object when there is no metadata", () => {
    expect(extractPageMetadata("<head></head>")).toEqual({});
  });
});
