import { describe, expect, it } from "vitest";

import { readStyles } from "../helpers/readStyles";

const styles = readStyles();

describe("chat session indicator stylesheet contract", () => {
  it("animates the row spinner and the toolbar spinner with one keyframe set", () => {
    expect(styles).toMatch(
      /\.attest-chat-session-spinner\s*\{[^}]*animation:\s*attest-session-spin\s+900ms\s+linear\s+infinite/s,
    );
    expect(styles).toMatch(
      /\.attest-chat__history-activity-spinner\s*\{[^}]*animation:\s*attest-session-spin/s,
    );
    expect(styles).toContain("@keyframes attest-session-spin");
  });

  it("stops both spinners when the reader asked for reduced motion", () => {
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.attest-chat-session-spinner,\s*\.attest-chat__history-activity-spinner\s*\{\s*animation:\s*none/s,
    );
  });

  it("marks a completed chat with the Obsidian success colour and a border", () => {
    expect(styles).toMatch(
      /\.attest-chat__session-dot\[data-status="completed"\]\s*\{[^}]*background:\s*var\(--color-green\)/s,
    );
    expect(styles).toMatch(
      /\.attest-chat__history-activity-dot\s*\{[^}]*border:[^;]*var\(--background-modifier-border-hover\)/s,
    );
  });

  it("gives the row Stop control a visible focus ring and reserves its space", () => {
    expect(styles).toMatch(
      /\.attest-chat__session-stop:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--interactive-accent\)/s,
    );
    expect(styles).toMatch(/\.attest-chat__session-status\s*\{[^}]*min-width:\s*2\.75rem/s);
  });

  it("positions the toolbar indicators absolutely so the button never moves", () => {
    expect(styles).toMatch(/\.attest-chat__icon-button\s*\{[^}]*position:\s*relative/s);
    expect(styles).toMatch(/\.attest-chat__history-activity\s*\{[^}]*position:\s*absolute/s);
    expect(styles).toMatch(
      /\.attest-chat__history-activity-spinner\.is-hidden,\s*\.attest-chat__history-activity-dot\.is-hidden\s*\{\s*display:\s*none/s,
    );
  });
});
