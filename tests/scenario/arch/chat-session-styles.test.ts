import { describe, expect, it } from "vitest";

import { readStyles } from "../../support/readStyles";

const styles = readStyles();

describe("chat session indicator stylesheet contract", () => {
  it("declares the session spinner, status dot, Stop control and toolbar indicator rules", () => {
    expect(styles).toMatch(
      /\.attest-chat-session-spinner\s*\{[^}]*animation:\s*attest-session-spin\s+900ms\s+linear\s+infinite/s,
    );
    expect(styles).toMatch(
      /\.attest-chat__history-activity-spinner\s*\{[^}]*animation:\s*attest-session-spin/s,
    );
    expect(styles).toContain("@keyframes attest-session-spin");

    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.attest-chat-session-spinner,\s*\.attest-chat__history-activity-spinner\s*\{\s*animation:\s*none/s,
    );

    expect(styles).toMatch(
      /\.attest-chat__session-dot\[data-status="completed"\]\s*\{[^}]*background:\s*var\(--color-green\)/s,
    );
    expect(styles).toMatch(
      /\.attest-chat__history-activity-dot\s*\{[^}]*border:[^;]*var\(--background-modifier-border-hover\)/s,
    );

    expect(styles).toMatch(
      /\.attest-chat__session-stop:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--interactive-accent\)/s,
    );
    expect(styles).toMatch(/\.attest-chat__session-status\s*\{[^}]*min-width:\s*2\.75rem/s);

    expect(styles).toMatch(/\.attest-chat__icon-button\s*\{[^}]*position:\s*relative/s);
    expect(styles).toMatch(/\.attest-chat__history-activity\s*\{[^}]*position:\s*absolute/s);
    expect(styles).toMatch(
      /\.attest-chat__history-activity-spinner\.is-hidden,\s*\.attest-chat__history-activity-dot\.is-hidden\s*\{\s*display:\s*none/s,
    );
  });
});
