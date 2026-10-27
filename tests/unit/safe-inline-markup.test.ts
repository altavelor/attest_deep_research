import { describe, expect, it } from "vitest";

import {
  cleanSafeMarkupSource,
  parseSafeMarkup,
  type SafeBlock,
  type SafeInline,
} from "@core/chat/safeInlineMarkup";
import { foldSafeMarkup } from "@core/chat/safeMarkupFold";

const IMPORT = `import-${"55e40e01".repeat(4)}`;
const TOKEN = `subagent:${IMPORT}:1`;

function text(nodes: readonly SafeInline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return node.text;
        case "break":
          return "/";
        case "code":
          return `<code ${node.text}>`;
        case "evidence":
          return `<source ${node.ordinal}>`;
        case "strong":
          return `<b ${text(node.children)}>`;
        case "emphasis":
          return `<i ${text(node.children)}>`;
      }
    })
    .join("");
}

function shape(blocks: readonly SafeBlock[]): string[] {
  return blocks.map((block) =>
    block.type === "list"
      ? `${block.ordered ? `ol${block.start}` : "ul"}[${block.items.map(text).join("|")}]`
      : `${block.type === "heading" ? "h" : "p"}:${text(block.children)}`,
  );
}

describe("safe inline markup", () => {
  it("parses the supported subset into paragraphs, headings, lists and inline marks", () => {
    expect(
      shape(
        parseSafeMarkup(
          "## Title **x**\nfirst **bold** and *it* or _it_\nsecond `co*de`\n\n- one\n* two\n3. three\n4) four\n\nafter",
        ),
      ),
    ).toEqual([
      "h:Title <b x>",
      "p:first <b bold> and <i it> or <i it>/second <code co*de>",
      "ul[one|two]",
      "ol3[three|four]",
      "p:after",
    ]);
  });

  it("keeps links, images, HTML and wikilinks inert and chips only real evidence tokens", () => {
    const source = [
      "[site](https://x.test) ![alt](https://x.test/i.png) <b>raw</b> <script>x</script>",
      `[[Note]] [${TOKEN}] [subagent:${IMPORT}:0] [subagent::1] [subagent:a:b:1] [subagent:import-55e40e:1]`,
      "[subagent:import 1:2] [source-123456] [subagent:import-x:1234567]",
    ].join("\n");
    expect(shape(parseSafeMarkup(source))).toEqual([
      [
        "p:site alt <b>raw</b> <script>x</script>/",
        `[[Note]] <source 1> [subagent:${IMPORT}:0] [subagent::1] [subagent:a:b:1] [subagent:import-55e40e:1]/`,
        "[subagent:import 1:2] [source-123456] [subagent:import-x:1234567]",
      ].join(""),
    ]);
    const evidence = parseSafeMarkup(`[${TOKEN}]`)[0] as Extract<SafeBlock, { type: "paragraph" }>;
    expect(evidence.children).toEqual([{ type: "evidence", ordinal: 1, token: TOKEN }]);
  });

  it("degrades unbalanced and too deep markers to literal text", () => {
    expect(
      shape(
        parseSafeMarkup(
          "**Не у\n*a **b** c* `open\nsnake_case_name **** * spaced*\n**1 *2 _3_ 2* 1** *x **y** x* *1 _2 **3** 2_ 1*",
        ),
      ),
    ).toEqual([
      "p:**Не у/<i a <b b> c> `open/snake_case_name **** * spaced*/<b 1 <i 2 _3_ 2> 1> <i x <b y> x> <i 1 <i 2 **3** 2> 1>",
    ]);
  });

  it("strips control and bidirectional override characters", () => {
    expect(
      shape(
        parseSafeMarkup(
          "a\u202eb\u2066c\u0007d\u0085e\u200bf\ufeffg\u{e0041}h\u2028i\r\nj\u200f👨\u200d👩 é\ufe0f",
        ),
      ),
    ).toEqual(["p:abcdefghi/j👨\u200d👩 é\ufe0f"]);
  });

  it("parses a 100k-character adversarial flood into one literal paragraph", () => {
    const flood = "[".repeat(50_000) + "]" + "*a_`**[!(".repeat(5_555);
    const blocks = parseSafeMarkup(flood);
    expect([blocks.length, blocks[0]!.type]).toEqual([1, "paragraph"]);
    expect(text((blocks[0] as { children: SafeInline[] }).children).slice(0, 50_001)).toBe(
      flood.slice(0, 50_001),
    );
  });

  it("caps the cleaned source without splitting a surrogate pair", () => {
    const capped = cleanSafeMarkupSource("x".repeat(131_071) + "😀z");
    expect(capped.length).toBe(131_071);
  });
});

describe("safe markup folding", () => {
  it("returns short text whole and cuts long text at a paragraph, line or word boundary", () => {
    expect(foldSafeMarkup("short **one**", 20)).toEqual({
      folded: false,
      blocks: parseSafeMarkup("short **one**"),
    });
    const paragraph = foldSafeMarkup(`${"a".repeat(12)}\n\n${"b".repeat(20)}`, 20);
    const line = foldSafeMarkup(`${"a".repeat(12)}\n${"b".repeat(20)}`, 20);
    const word = foldSafeMarkup(`${"a ".repeat(8)}bbbbbbbbbbbbbbbb`, 20);
    expect([paragraph, line, word].map((fold) => [fold.folded, shape(fold.blocks)])).toEqual([
      [true, [`p:${"a".repeat(12)}…`]],
      [true, [`p:${"a".repeat(12)}…`]],
      [true, [`p:${"a ".repeat(8).trimEnd()}…`]],
    ]);
  });

  it("never cuts inside a marker, an evidence token or a surrogate pair", () => {
    const bold = foldSafeMarkup(`intro text **Не удалось найти источники** tail`, 24);
    const token = foldSafeMarkup(`intro text here [${TOKEN}] tail`, 22);
    const emoji = foldSafeMarkup(`${"x".repeat(19)}😀😀😀`, 20);
    const joined = foldSafeMarkup(`${"x".repeat(19)}e\u0301\u200d❤\ufe0fyyyy`, 20);
    expect([
      shape(bold.blocks),
      shape(token.blocks),
      shape(emoji.blocks),
      shape(joined.blocks),
    ]).toEqual([
      ["p:intro text…"],
      ["p:intro text here…"],
      [`p:${"x".repeat(19)}…`],
      [`p:${"x".repeat(19)}…`],
    ]);
  });
});
