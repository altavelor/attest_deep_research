# Spec: Rich media in research answers

## Status and objective

Draft. Add safe, attributable image galleries, Markdown tables, and simple charts to desktop Obsidian research answers without changing text-only behavior. Artefacts are appended after the streamed Markdown answer; arbitrary placement within streamed prose and Mobile-specific UI are out of scope.

## Decisions

- Tables are ordinary Markdown; charts and galleries are typed `AnswerArtifact`s.
- Images can come from enabled Wikimedia Commons/Openverse resources, fetched web pages, or documents that Ixplorer already supports: `.md`, `.txt`, `.pdf`, `.epub`, `.fb2`, `.docx`.
- Wikimedia Commons and Openverse are independently toggled **Image search** web resources, disabled by default; they do not affect normal `search_web` ranking.
- A general engine that also serves images (Brave, Google, Serper, SearXNG) joins image search only after a per-source **Use for image search** opt-in; enabling it for text search never spends quota on image queries.
- Third-party images are hotlinked only. No proxy, cache, download, vault write, or separate remote-image-loading setting exists in v1.
- A global `REQUIRED_INDEX_VERSION = 1` enables index-discovered local images. Existing indexes remain usable for text retrieval but require a full rebuild for image discovery.
- No image generation, OCR, editing, bulk asset management, or arbitrary model HTML/SVG/JS is in scope.

## Commands

- Targeted: `npm test -- tests/unit/rich-answer-artifacts.test.ts tests/unit/image-search-research-tool.test.ts tests/unit/image-gallery-renderer.test.ts`
- Full validation: `npm run check`

## Architecture

| Layer                               | Responsibility                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `src/core/answer.ts` / conversation | Backward-compatible artifact DTOs and message propagation.                          |
| `src/application/ports/`            | Image search, vault-document image resolution, and web-fetch contracts.             |
| `src/adapters/research-tools/`      | Search, extraction, validation, per-run registry, and tool registration.            |
| `src/adapters/indexing/store/`      | Compact image manifest and global index-version state.                              |
| `src/adapters/web-sources/`         | Wikimedia Commons and Openverse implementations.                                    |
| `src/apps/obsidian/ui/chat/`        | Markdown table treatment, gallery/lightbox, chart renderer, and stale-index notice. |
| `src/apps/obsidian/ui/settings/`    | Web-resource toggles and `Reindex required` index tag.                              |

## Contracts

```ts
type AnswerArtifact =
  | { type: "image-gallery"; id: string; title?: string; images: AnswerImage[] }
  | {
      type: "chart";
      id: string;
      title: string;
      chartType: "bar" | "line" | "scatter" | "pie";
      xLabel?: string;
      yLabel?: string;
      series: Array<{ name: string; points: Array<{ x: string | number; y: number }> }>;
      caption?: string;
    };

interface AnswerImage {
  id: string;
  thumbnailUrl?: string;
  fullUrl?: string;
  vaultSource?: { documentPath: string; locator: string };
  alt: string;
  caption?: string;
  sourceUrl: string;
  sourceLabel: string;
}
```

A vault-backed image carries the document's fingerprint, which is verified before the image is re-extracted, so a replaced document shows the unavailable fallback instead of an unrelated image. `ResearchAnswer.artifacts` is optional; missing means no artefacts. IDs are opaque and per-answer. Persisted artifacts never contain OS paths, raw image bytes, archive member paths, or session resource URLs.

| Tool                    | Availability                              | Contract                                                                                                                            |
| ----------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `search_images`         | At least one image resource enabled       | Searches enabled resources; returns normalized, bounded candidates with attribution and licence metadata when supplied.             |
| `present_image_gallery` | Image candidates exist in the current run | Accepts 1–4 unique current-run IDs only; it never accepts URLs.                                                                     |
| `present_chart`         | Model supports tools                      | Accepts only chart DTO data: ≤4 series and ≤50 points/series; finite values; pie has one non-negative series with a positive total. |

Invalid inputs produce no artifact and never fail the textual answer. The synthesis prompt uses visuals only when they improve the answer and retains citations in nearby prose/captions.

## Display

- **Images:** a 1–4-card gallery appears after Markdown. A card shows alt text and attribution. Selecting it opens a full-size viewer with caption, source link, Escape/backdrop close, arrow navigation when applicable, and focus restoration. Failed hotlinks and unavailable local files render an attribution/source fallback card.
- **Tables:** `MarkdownRenderer` renders normal Markdown tables. CSS provides horizontal overflow; tables stay selectable and copyable. The model uses headers, ≤8 columns, ≤30 rows, and no HTML table markup.
- **Charts:** bar, line, scatter, and pie render as local accessible SVG, with title, legend, caption, and equivalent text table. Colour is not the sole differentiator. No model- or provider-supplied SVG, URL, style, script, or event handler is rendered.
- **Persistence:** a saved note exports image attribution/source links and chart data as a Markdown table. Saved chats restore artifacts; legacy chats load with none.

## Image sources and extraction

| Source            | Required behavior                                                                                                                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wikimedia Commons | Preserve file page, thumbnail/full URL, title, creator/credit, licence name/URL, and attribution requirement.                                                                                                                                            |
| Openverse         | Preserve landing page, thumbnail/full URL, creator where supplied, licence/version/URL, and attribution text. Treat licence data as discovery metadata, not a legal guarantee.                                                                           |
| Fetched page      | From registered `fetch_web_page` results only: collect up to 8 candidates, preferring `og:image`/`twitter:image`, then content images in document order. Resolve relative URLs, deduplicate, and keep page title/canonical URL as attribution.           |
| `.md` / `.txt`    | Extract supported Obsidian wiki embeds and vault-relative Markdown image links. Plain text has no other intrinsic image form.                                                                                                                            |
| `.pdf`            | Extract raster image objects using page number and ordinal as locator. JPEG streams pass through; 8-bit gray/RGB Flate rasters are re-encoded as PNG. Colour spaces that cannot be reproduced exactly (CMYK, indexed, sub-byte depths, JPX) are skipped. |
| `.docx`           | Extract OOXML `word/media` resources and relationship metadata where available.                                                                                                                                                                          |
| `.epub`           | Extract manifest images referenced from spine content.                                                                                                                                                                                                   |
| `.fb2`            | Extract referenced base64 `<binary>` images.                                                                                                                                                                                                             |

Eligible formats are PNG, JPEG, WebP, GIF, and AVIF. Reject SVG, HTML images, remote Markdown image URLs, `data:`/`blob:`/`file:`/`javascript:` URLs, tracking pixels, invalid HTTPS URLs, and unsupported encodings. Extraction occurs only for documents in the current request/context or read by tools; it never scans the vault just to discover images.

Vault-file artifacts resolve a contained vault-relative path at render time. Embedded document artifacts reread and re-extract the stored locator, create a temporary object URL, then revoke it on rerender/disposal. Missing, moved, changed, or unreadable sources render the unavailable fallback.

## Index migration

Each full rebuild writes a compact image manifest: document path/hash, format, opaque locator, safe caption/alt text, and bounded display metadata—never bytes or OS paths. `FileVectorManifest.indexVersion` is optional; absent means `0`. Version `1` requires this image manifest.

Only a successful full rebuild advances to `REQUIRED_INDEX_VERSION`; incremental refreshes, failed, paused, or cancelled rebuilds do not. Once the manifest exists, an incremental refresh keeps it consistent by replacing the rows of the documents it re-indexed, so discovery never serves rows for content the index no longer holds. Index profiles below the required version show `Reindex required` in Settings, with the reason that document-image metadata is missing. Selecting one in chat shows a non-blocking warning that text search works but index-based image discovery needs rebuilding, plus an action to open index settings. Error/suspended state has visual priority.

## Safety, limits, and lifecycle

- Validate public HTTPS URLs and vault-path containment; reject credentials, localhost/private networks, absolute/`..` paths, and internal Ixplorer paths.
- Bound strings, query/output size, candidate count, compressed bytes, total extracted bytes, decoded pixels, chart points, and archive entries. Reject corrupt archives, traversal paths, malformed PDF objects, and decompression-bomb-like assets.
- Treat provider fields, fetched HTML, tool arguments, and document metadata as untrusted. Pass only normalized data to the model/UI.
- Preserve attribution and distinguish licensed-provider images from page references. Never describe a page reference as licensed content.
- Honour cancellation; dispose modal listeners and revoke object URLs.

## Testing and success criteria

Use deterministic Vitest tests for artifact compatibility/validation, provider normalization, every document extractor, fetch extraction, settings toggles, index-version migration, tool limits, persistence, fallbacks, keyboard/focus cleanup, table overflow, and chart accessibility.

Done means enabled resources work independently; valid galleries/tables/charts render safely; every supported document format yields eligible local candidates; old indexes show the settings/chat rebuild notices until fully rebuilt; invalid external or document data degrades to text; legacy chats remain loadable; and `npm run check` passes.

## Boundaries

- Always: preserve text answers/citations, compatibility, attribution, accessibility, cleanup, and error handling.
- Ask first: add dependencies, enable another provider, change privacy/retention, proxy/cache/download third-party bytes, or add generated images.
- Never: accept model-provided markup or arbitrary URLs, cache/proxy third-party media in v1, or label page images as licensed without provider metadata.
