import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const outputDirectory = new URL("../tests/fixtures/pdf/", import.meta.url);

/** Builds a compressed PDF stream with its exact byte length. */
function stream(content) {
  const compressed = deflateSync(Buffer.from(content));
  return Buffer.concat([
    Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),
    compressed,
    Buffer.from("\nendstream"),
  ]);
}

/** Builds a text-only PDF with explicit Unicode mappings and deterministic cross references. */
function buildPdf(pages) {
  const characters = [...new Set(pages.join("\n").replaceAll("\n", ""))];
  const code = (character) => (characters.indexOf(character) + 33).toString(16).padStart(2, "0");
  const encode = (line) => [...line].map(code).join("");
  const mappings = characters.map(
    (character) =>
      `<${code(character)}> <${character.charCodeAt(0).toString(16).padStart(4, "0")}>`,
  );
  const cmap = `/CIDInit /ProcSet findresource begin
12 dict begin begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /SyntheticUnicode def /CMapType 2 def
1 begincodespacerange <00> <ff> endcodespacerange
${mappings.length} beginbfchar
${mappings.join("\n")}
endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`;
  const pageIds = pages.map((_, index) => 5 + index * 2);
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from(
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    ),
    Buffer.from(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode 4 0 R >>",
    ),
    stream(cmap),
  ];

  for (const [index, text] of pages.entries()) {
    const id = pageIds[index];
    const lines = text.split("\n");
    const content = lines
      .map((line, lineIndex) => `${lineIndex === 0 ? "" : "T* "}<${encode(line)}> Tj`)
      .join("\n");
    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`,
      ),
      stream(text ? `BT /F1 10 Tf 12 TL 20 750 Td\n${content}\nET` : ""),
    );
  }

  const parts = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  let position = parts[0].length;
  for (const [index, object] of objects.entries()) {
    offsets.push(position);
    const entry = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n"),
    ]);
    parts.push(entry);
    position += entry.length;
  }
  parts.push(
    Buffer.from(
      `xref\n0 ${offsets.length}\n0000000000 65535 f\r\n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, "0")} 00000 n\r\n`)
        .join(
          "",
        )}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}

const paragraph =
  "Research notes describe local indexing, page citations, and stable chunk identifiers. ";
const fixtures = {
  "synthetic-pages.pdf": ["First page title\nFirst page body.", "", "Second page text."],
  "synthetic-unicode.pdf": Array.from({ length: 5 }, () => "Сезон сбора клюквы"),
  "synthetic-book.pdf": [
    "Synthetic book cover.",
    ...Array.from({ length: 6 }, (_, index) =>
      (`Synthetic chapter ${index + 2}. ` + paragraph.repeat(23)).match(/.{1,85}/g).join("\n"),
    ),
  ],
};

mkdirSync(outputDirectory, { recursive: true });
for (const [name, pages] of Object.entries(fixtures)) {
  writeFileSync(new URL(name, outputDirectory), buildPdf(pages));
}
