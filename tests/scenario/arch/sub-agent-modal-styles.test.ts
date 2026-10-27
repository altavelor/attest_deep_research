import { describe, expect, it } from "vitest";

import { readStyles } from "../../support/readStyles";

const styles = readStyles();

describe("sub-agent sessions modal stylesheet contract", () => {
  it("gives the work log a rail gutter and lets the resizable modal body fill its height", () => {
    expect(styles).toMatch(
      /\.attest-sub-agents__work-gutter\s*\{[^}]*position:\s*relative;[^}]*padding-left:\s*calc\(1\.3rem \+ 6px\)/s,
    );
    expect(styles).toMatch(/\.attest-sub-agents__work-gutter::before\s*\{[^}]*left:\s*10px/s);
    expect(styles).toMatch(
      /\.modal\.attest-sub-agents-modal--resizable\s*\{[^}]*width:\s*var\(--attest-sub-agents-width[^}]*height:\s*var\(--attest-sub-agents-height/s,
    );
    expect(styles).toMatch(
      /\.attest-sub-agents\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto/s,
    );
    expect(styles).not.toMatch(/\.attest-sub-agents\s*\{[^}]*max-height:\s*72vh/s);
    expect(styles).toMatch(/\.attest-sub-agents__resize\s*\{[^}]*touch-action:\s*none/s);
  });
});
