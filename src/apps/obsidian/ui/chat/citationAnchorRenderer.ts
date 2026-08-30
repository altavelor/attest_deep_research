import { ChatCitationRef } from "./citations/CitationPopover";
import { countAnchors, splitCitationText } from "./citations/citationTextParts";
import type { ChatTranscriptOptions } from "./ChatTranscript";

export function renderInlineCitationAnchors(
  containerEl: HTMLElement,
  refs: ChatCitationRef[],
  options: ChatTranscriptOptions,
): void {
  const refByChunkId = new Map<string, ChatCitationRef>();
  for (const ref of refs) {
    for (const chunkId of ref.chunkIds) refByChunkId.set(chunkId, ref);
  }

  const createAnchor = (parent: Node, ref: ChatCitationRef): HTMLElement => {
    const button = containerEl.createEl("button", {
      cls: "attest-chat__citation-anchor",
      text: `[${ref.number}]`,
      attr: { type: "button" },
    });
    parent.appendChild(button);
    button.setAttr("aria-label", options.t("chat.citation.openSource", { number: ref.number }));
    button.dataset.citationKey = ref.key;
    button.addEventListener("mouseenter", () => options.onOpenCitationPopover(button, ref));
    button.addEventListener("mouseleave", () => options.onScheduleCitationPopoverClose(ref.key));
    button.addEventListener("focus", () => options.onOpenCitationPopover(button, ref));
    button.addEventListener("blur", () => options.onScheduleCitationPopoverClose(ref.key));
    button.addEventListener("click", () => {
      if (/^source-\d+:revision-\d+$/u.test(ref.chunk.id) && options.onOpenRegistryRevision) {
        options.onOpenRegistryRevision(ref.chunk.id);
      } else {
        options.onScrollCitationBlockIntoView(ref.key);
      }
    });
    return button;
  };
  const replacementCount = replaceCitationTextNodes(containerEl, refByChunkId, createAnchor);
  if (replacementCount === 0) appendFallbackCitationAnchors(containerEl, refs, createAnchor);
}

function replaceCitationTextNodes(
  containerEl: HTMLElement,
  refByChunkId: Map<string, ChatCitationRef>,
  createAnchor: (parent: Node, ref: ChatCitationRef) => HTMLElement,
): number {
  const ownerDocument = containerEl.ownerDocument;
  const showText = ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = ownerDocument.createTreeWalker(containerEl, showText);
  const textNodes: Text[] = [];
  let replacementCount = 0;
  while (walker.nextNode()) {
    if (walker.currentNode.nodeType === 3) textNodes.push(walker.currentNode as Text);
  }

  for (const textNode of textNodes) {
    const parts = splitCitationText(textNode.nodeValue ?? "", (chunkId) =>
      refByChunkId.has(chunkId),
    );
    if (parts === null) continue;
    replacementCount += countAnchors(parts);

    const fragment = (
      containerEl.win as Window & { createFragment(): DocumentFragment }
    ).createFragment();
    for (const part of parts) {
      if (part.kind === "anchor") {
        createAnchor(fragment, refByChunkId.get(part.chunkId)!);
      } else {
        fragment.append(ownerDocument.createTextNode(part.value));
      }
    }
    textNode.replaceWith(fragment);
  }
  return replacementCount;
}

function appendFallbackCitationAnchors(
  containerEl: HTMLElement,
  refs: ChatCitationRef[],
  createAnchor: (parent: Node, ref: ChatCitationRef) => HTMLElement,
): void {
  const ownerDocument = containerEl.ownerDocument;
  const targets = Array.from(containerEl.querySelectorAll<HTMLElement>("p, li")).filter((element) =>
    Boolean(element.textContent?.trim()),
  );
  const fallbackTarget = targets.at(-1) ?? containerEl;
  for (const ref of refs) {
    const target = bestCitationTarget(targets, ref) ?? fallbackTarget;
    target.append(ownerDocument.createTextNode(" "));
    createAnchor(target, ref);
  }
}

function bestCitationTarget(targets: HTMLElement[], ref: ChatCitationRef): HTMLElement | undefined {
  let best: { element: HTMLElement; score: number } | undefined;
  const sourceTokens = tokenSet(ref.chunk.text);
  if (sourceTokens.size === 0) return undefined;

  for (const target of targets) {
    const targetTokens = tokenSet(target.textContent ?? "");
    let score = 0;
    for (const token of targetTokens) {
      if (sourceTokens.has(token)) score += 1;
    }
    if (score > (best?.score ?? 0)) best = { element: target, score };
  }
  return best && best.score >= 2 ? best.element : undefined;
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^\p{L}\p{N}_]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 5),
  );
}
