import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const text = "Сезон сбора клюквы";
const characters = [...new Set(text)];
const encode = (value) =>
  [...value]
    .map((character) => (characters.indexOf(character) + 65).toString(16).padStart(2, "0"))
    .join("");
const mappings = characters.map(
  (character, index) =>
    `<${(index + 65).toString(16).padStart(2, "0")}> <${character.charCodeAt(0).toString(16).padStart(4, "0")}>`,
);
const cmap = `/CIDInit /ProcSet findresource begin
12 dict begin begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /FixtureUnicode def /CMapType 2 def
1 begincodespacerange <00> <ff> endcodespacerange
${mappings.length} beginbfchar
${mappings.join("\n")}
endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`;

/** Builds a PDF stream with its byte length and Flate compression. */
function stream(content) {
  const compressed = deflateSync(Buffer.from(content));
  return Buffer.concat([
    Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),
    compressed,
    Buffer.from("\nendstream"),
  ]);
}

const pageIds = [5, 7, 9, 11, 13];
const objects = [
  Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
  Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count 5 >>`),
  Buffer.from(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode 4 0 R >>",
  ),
  stream(cmap),
];
for (const id of pageIds) {
  objects.push(
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`,
    ),
    stream(`BT /F1 12 Tf 20 150 Td <${encode(text)}> Tj ET`),
  );
}
const parts = [Buffer.from("%PDF-1.4\n")];
const offsets = [0];
for (const [index, object] of objects.entries()) {
  offsets.push(Buffer.concat(parts).length);
  parts.push(Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n"));
}
const xrefOffset = Buffer.concat(parts).length;
parts.push(
  Buffer.from(
    `xref\n0 ${offsets.length}\n0000000000 65535 f\r\n${offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n\r\n`)
      .join(
        "",
      )}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ),
);
writeFileSync(
  new URL("../tests/fixtures/pdf/plain-text.pdf", import.meta.url),
  Buffer.concat(parts),
);
