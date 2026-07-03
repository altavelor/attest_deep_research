// Dependency-free PDF text parser (fallback when pdfjs is unavailable, e.g. in
// tests). Pure code move out of PdfExtractor.ts; no behavior changes. Does not
// extract typography metrics or outline — heading extraction needs pdfjs.

import { inflateSync } from "zlib";

import type { PdfPageText, PdfPageTextParser } from "./PdfExtractor";

type UnicodeMap = Map<number, string>;

export class SimplePdfTextParser implements PdfPageTextParser {
  async *parsePages(data: ArrayBuffer): AsyncIterable<PdfPageText> {
    const source = Buffer.from(data).toString("latin1");
    const objects = parsePdfObjects(source);
    const pages = [...objects.entries()]
      .filter(([, body]) => /\/Type\s*\/Page\b/.test(body))
      .map(([objectNumber, body]) => ({ objectNumber, body }))
      .sort((left, right) => left.objectNumber - right.objectNumber);

    for (let index = 0; index < pages.length; index += 1) {
      const fontMaps = readPageFontMaps(pages[index].body, objects);
      const contentObjectNumbers = readContentObjectNumbers(pages[index].body);
      const text = contentObjectNumbers
        .map((objectNumber) => objects.get(objectNumber) ?? "")
        .map(extractStream)
        .filter((stream): stream is string => stream !== null)
        .flatMap((stream) => extractTextOperations(stream, fontMaps))
        .join("\n");

      yield {
        pageNumber: index + 1,
        text,
      };
    }
  }
}

function parsePdfObjects(source: string): Map<number, string> {
  const objects = new Map<number, string>();
  const objectPattern = /(\d+)\s+\d+\s+obj\s*([\s\S]*?)\s*endobj/g;
  let match: RegExpExecArray | null;

  while ((match = objectPattern.exec(source)) !== null) {
    objects.set(Number(match[1]), match[2]);
  }

  return objects;
}

function readContentObjectNumbers(pageObject: string): number[] {
  const directMatch = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(pageObject);

  if (directMatch) {
    return [Number(directMatch[1])];
  }

  const arrayMatch = /\/Contents\s*\[([\s\S]*?)\]/.exec(pageObject);

  if (!arrayMatch) {
    return [];
  }

  return [...arrayMatch[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((match) => Number(match[1]));
}

function extractStream(objectBody: string): string | null {
  const match = /stream\r?\n?([\s\S]*?)\r?\n?endstream/.exec(objectBody);

  if (!match) {
    return null;
  }

  if (!/\/Filter\s*\/FlateDecode\b/.test(objectBody)) {
    return match[1];
  }

  return inflateSync(Buffer.from(unwrapPdfStreamData(match[1]), "latin1")).toString("latin1");
}

function unwrapPdfStreamData(value: string): string {
  return value.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}

function readPageFontMaps(
  pageObject: string,
  objects: Map<number, string>,
): Map<string, UnicodeMap> {
  const fontMaps = new Map<string, UnicodeMap>();
  const fontReferences = [...pageObject.matchAll(/\/(F\d+)\s+(\d+)\s+\d+\s+R/g)];

  for (const match of fontReferences) {
    const fontName = match[1];
    const fontObject = objects.get(Number(match[2])) ?? "";
    const toUnicodeObjectNumber = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(fontObject)?.[1];

    if (!toUnicodeObjectNumber) {
      continue;
    }

    const toUnicodeObject = objects.get(Number(toUnicodeObjectNumber)) ?? "";
    const stream = extractStream(toUnicodeObject);

    if (stream) {
      fontMaps.set(fontName, parseToUnicodeCMap(stream));
    }
  }

  return fontMaps;
}

function parseToUnicodeCMap(cmap: string): UnicodeMap {
  const unicodeMap: UnicodeMap = new Map();
  const bfcharPattern = /beginbfchar([\s\S]*?)endbfchar/g;
  const bfrangePattern = /beginbfrange([\s\S]*?)endbfrange/g;
  let match: RegExpExecArray | null;

  while ((match = bfcharPattern.exec(cmap)) !== null) {
    for (const entry of match[1].matchAll(/<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/g)) {
      unicodeMap.set(Number.parseInt(entry[1], 16), decodeUnicodeHex(entry[2]));
    }
  }

  while ((match = bfrangePattern.exec(cmap)) !== null) {
    for (const entry of match[1].matchAll(
      /<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/g,
    )) {
      const start = Number.parseInt(entry[1], 16);
      const end = Number.parseInt(entry[2], 16);
      const destinationStart = Number.parseInt(entry[3], 16);

      for (let code = start; code <= end; code += 1) {
        unicodeMap.set(code, String.fromCodePoint(destinationStart + code - start));
      }
    }
  }

  return unicodeMap;
}

function extractTextOperations(stream: string, fontMaps: Map<string, UnicodeMap>): string[] {
  const text: string[] = [];
  const operationPattern =
    /\/([A-Za-z0-9]+)\s+[-\d.]+\s+Tf|(\((?:\\.|[^\\)])*\))\s*Tj|<([0-9A-Fa-f\s]+)>\s*Tj|\[([\s\S]*?)\]\s*TJ/g;
  let match: RegExpExecArray | null;
  let currentFontMap: UnicodeMap | undefined;

  while ((match = operationPattern.exec(stream)) !== null) {
    if (match[1]) {
      currentFontMap = fontMaps.get(match[1]);
    } else if (match[2]) {
      text.push(decodePdfLiteralString(match[2]));
    } else if (match[3]) {
      text.push(decodePdfHexString(match[3], currentFontMap));
    } else if (match[4]) {
      text.push(
        [...match[4].matchAll(/\((?:\\.|[^\\)])*\)|<([0-9A-Fa-f\s]+)>/g)]
          .map((item) =>
            item[1] ? decodePdfHexString(item[1], currentFontMap) : decodePdfLiteralString(item[0]),
          )
          .join(""),
      );
    }
  }

  return text.map((item) => item.trim()).filter(Boolean);
}

function decodePdfHexString(value: string, unicodeMap: UnicodeMap | undefined): string {
  const hex = value.replace(/\s/g, "");
  let decoded = "";

  for (let index = 0; index < hex.length; index += 4) {
    const code = Number.parseInt(hex.slice(index, index + 4), 16);

    if (Number.isNaN(code)) {
      continue;
    }

    decoded += unicodeMap?.get(code) ?? String.fromCodePoint(code);
  }

  return decoded;
}

function decodeUnicodeHex(value: string): string {
  let decoded = "";

  for (let index = 0; index < value.length; index += 4) {
    const codePoint = Number.parseInt(value.slice(index, index + 4), 16);

    if (!Number.isNaN(codePoint)) {
      decoded += String.fromCodePoint(codePoint);
    }
  }

  return decoded;
}

function decodePdfLiteralString(value: string): string {
  const body = value.slice(1, -1);
  let decoded = "";

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];

    if (character !== "\\") {
      decoded += character;
      continue;
    }

    index += 1;
    const escaped = body[index];
    decoded += decodePdfEscape(escaped);
  }

  return decoded;
}

function decodePdfEscape(value: string | undefined): string {
  switch (value) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    case "b":
      return "\b";
    case "f":
      return "\f";
    case "(":
    case ")":
    case "\\":
      return value;
    default:
      return value ?? "";
  }
}
