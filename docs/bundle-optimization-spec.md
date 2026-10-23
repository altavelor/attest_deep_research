# Bundle reduction specification

## Objective and acceptance

Reduce `main.js` by at least 50% from the original 3,735,184 bytes, preserving
PDF extraction, Mobile support, translations, and model providers. Enforce a
1,750,000-byte budget, which also halves the intermediate 3,523,719-byte build.
Keep the agreed download metric based on `main.js` across releases.

## Design and structure

Use Obsidian's public `loadPdfJs()` API in the PDF adapter instead of embedding
a second PDF.js runtime and worker. Obsidian owns loading and worker setup;
the adapter continues to own each document loading task and destroys it after
success or failure. Load the runtime only when parsing a PDF. Keep `pdfjs-dist`
as a development dependency for deterministic fixture tests.

Source remains in `src/adapters/extractors/`; tests remain in `tests/unit/` and
`tests/scenario/`, with the host loader fake under `tests/support/obsidian/`.
Preserve existing interfaces and follow nearby TypeScript style:

```ts
const pdfjs = await loadPdfJs();
```

## Ordered tasks and verification

1. Characterize lazy host loading, bounded page parsing, and document cleanup
   with Vitest fakes. Retain real PDF fixture extraction scenarios.
2. Switch the adapter to the host runtime; move PDF.js to development dependencies.
   Verify the targeted PDF tests and `npm run build`.
3. Enforce the size budget and update the analysis. Run `npm ci` and
   `npm run check`, inspect `node esbuild.config.mjs production --analyze`, and
   verify PDF.js is absent from production contributions.
4. Review, commit, and update the existing pull request.

## Boundaries and risks

Always preserve chunk identities, page citations, outlines, error mapping, and
loading-task cleanup. Never add remote script downloads or mutate the host's
global PDF worker configuration. No new production dependencies or release assets.
The runtime version follows Obsidian; fixture tests exercise the PDF API seam,
while real-device compatibility remains a manual release check.
