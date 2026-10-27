import { setIcon } from "obsidian";

import type { Translate } from "@adapters/i18n";
import type { SafeBlock, SafeInline } from "@core/chat/safeInlineMarkup";
import { foldSafeMarkup } from "@core/chat/safeMarkupFold";

/**
 * Builds DOM for a parsed safe-markup tree with createEl and text nodes only. Evidence
 * tokens become inert chips whose full token sits in the title attribute.
 */
export function renderSafeMarkup(
  parentEl: HTMLElement,
  blocks: readonly SafeBlock[],
  t: Translate,
): void {
  for (const block of blocks) {
    if (block.type === "list") {
      const listEl = parentEl.createEl(block.ordered ? "ol" : "ul", {
        cls: "attest-chat__agent-markup-list",
      });
      if (block.ordered && block.start !== 1) listEl.setAttribute("start", String(block.start));
      for (const item of block.items) renderInline(listEl.createEl("li"), item, t);
      continue;
    }
    const paragraphEl = parentEl.createEl("p", {
      cls:
        block.type === "heading"
          ? "attest-chat__agent-markup-heading"
          : "attest-chat__agent-markup-paragraph",
    });
    renderInline(
      block.type === "heading" ? paragraphEl.createEl("strong") : paragraphEl,
      block.children,
      t,
    );
  }
}

function renderInline(parentEl: HTMLElement, nodes: readonly SafeInline[], t: Translate): void {
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        parentEl.appendText(node.text);
        break;
      case "break":
        parentEl.createEl("br");
        break;
      case "code":
        parentEl.createEl("code", { text: node.text });
        break;
      case "strong":
        renderInline(parentEl.createEl("strong"), node.children, t);
        break;
      case "emphasis":
        renderInline(parentEl.createEl("em"), node.children, t);
        break;
      case "evidence":
        parentEl.createSpan({
          cls: "attest-chat__agent-evidence",
          text: t("chat.agent.evidence", { ordinal: String(node.ordinal) }),
          attr: { title: `[${node.token}]` },
        });
        break;
    }
  }
}

/**
 * Renders a folded preview of untrusted child markup and, when the text was folded, a
 * link-style toggle that swaps in the full rendered text.
 */
export function renderFoldedMarkup(
  parentEl: HTMLElement,
  source: string,
  limit: number,
  expandLabel: string,
  t: Translate,
): void {
  const textEl = parentEl.createDiv({ cls: "attest-chat__agent-text attest-chat__agent-markup" });
  const preview = foldSafeMarkup(source, limit);
  renderSafeMarkup(textEl, preview.blocks, t);
  if (!preview.folded) return;
  renderToggle(parentEl, expandLabel, t, (expanded) => {
    textEl.empty();
    renderSafeMarkup(
      textEl,
      expanded ? foldSafeMarkup(source, Infinity).blocks : preview.blocks,
      t,
    );
  });
}

/** Adds a light disclosure toggle with a chevron that reports its expanded state. */
export function renderToggle(
  parentEl: HTMLElement,
  expandLabel: string,
  t: Translate,
  onToggle: (expanded: boolean) => void,
): void {
  const toggle = parentEl.createEl("button", {
    cls: "attest-chat__agent-toggle",
    attr: { type: "button", "aria-expanded": "false" },
  });
  const labelEl = toggle.createSpan({ text: expandLabel });
  const chevronEl = toggle.createSpan({
    cls: "attest-chat__agent-toggle-chevron",
    attr: { "aria-hidden": "true" },
  });
  setIcon(chevronEl, "chevron-down");
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") !== "true";
    labelEl.setText(expanded ? t("chat.agent.showLess") : expandLabel);
    chevronEl.empty();
    setIcon(chevronEl, expanded ? "chevron-up" : "chevron-down");
    toggle.setAttribute("aria-expanded", String(expanded));
    onToggle(expanded);
  });
}
