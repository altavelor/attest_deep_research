import type { Translate } from "@adapters/i18n";

export interface ClaimBarCounts {
  supported: number;
  conflicted: number;
  unverified: number;
}

/**
 * Renders the claim verification bar with its legend: supported, conflicting and unverified
 * claims.
 */
export function renderClaimBar(parentEl: HTMLElement, counts: ClaimBarCounts, t: Translate): void {
  const parts = [
    ["supported", counts.supported],
    ["conflicted", counts.conflicted],
    ["unverified", counts.unverified],
  ] as const;
  const legend = parts.map(([kind, count]) =>
    t(`chat.deepResearch.report.claims.${kind}`, { count }),
  );
  const barEl = parentEl.createDiv({
    cls: "attest-research-claims__bar",
    attr: { role: "img", "aria-label": legend.join(", ") },
  });
  const legendEl = parentEl.createDiv({ cls: "attest-research-claims__legend" });
  parts.forEach(([kind, count], index) => {
    if (count > 0) {
      barEl.createDiv({ cls: `attest-research-claims__bar-part is-${kind}` }).style.flexGrow =
        String(count);
    }
    const itemEl = legendEl.createSpan({ cls: `attest-research-claims__legend-item is-${kind}` });
    itemEl.createSpan({ cls: "attest-research-claims__dot", attr: { "aria-hidden": "true" } });
    itemEl.appendText(legend[index]!);
  });
}
