import { describe, expect, it } from "vitest";

import { readStyles } from "../helpers/readStyles";

const styles = readStyles();

describe("mobile stylesheet contract", () => {
  it("stacks settings rows on narrow screens", () => {
    expect(styles).toContain("@media (max-width: 600px)");
    expect(styles).toMatch(
      /\.attest-settings-profile-list__item,[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/s,
    );
    expect(styles).toMatch(/\.attest-settings-profile-table__header\s*\{[^}]*display:\s*none/s);
  });

  it("keeps actions visible and touch targets usable for coarse pointers", () => {
    expect(styles).toContain("@media (hover: none), (pointer: coarse)");
    expect(styles).toMatch(
      /\.attest-chat__message-actions,[\s\S]*?\.attest-chat__saved-actions[\s\S]*?opacity:\s*1/s,
    );
    expect(styles).toContain("min-height: 44px");
    expect(styles).toContain("min-width: 44px");
  });

  it("accounts for dynamic mobile viewport height and safe areas", () => {
    expect(styles).toContain("height: 100dvh");
    expect(styles).toContain("max-height: calc(100dvh - 1rem)");
    expect(styles).toContain("env(safe-area-inset-bottom)");
  });

  it("wraps long source and settings text", () => {
    expect(styles).toMatch(
      /\.attest-chat__citation-block-source,[\s\S]*?overflow-wrap:\s*anywhere/s,
    );
    expect(styles).toMatch(/\.attest-settings-index-list__meta,[\s\S]*?overflow-wrap:\s*anywhere/s);
  });
});
