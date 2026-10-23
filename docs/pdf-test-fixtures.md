# Synthetic PDF fixtures

Every PDF in `tests/fixtures/pdf/` is generated from original test text by:

```bash
node scripts/generate-pdf-fixtures.mjs
```

- `synthetic-pages.pdf`: three pages with an empty middle page, checking text and
  preservation of page numbers when empty pages are skipped.
- `synthetic-unicode.pdf`: five pages of Cyrillic text, compressed streams, and
  explicit ToUnicode mappings.
- `synthetic-book.pdf`: a cover and six text chapters, exercising seven page
  citations and thirteen chunks at the test's 1,500-character chunk limit.

The files contain no real books, images, or third-party embedded fonts. Generation
is deterministic and requires only Node.js. Tests read the committed PDFs rather
than running a generator or accessing the network.
