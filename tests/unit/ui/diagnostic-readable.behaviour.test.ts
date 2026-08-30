// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderReadableDiagnosticReport } from "@apps/obsidian/ui/diagnostics/readable";
import type { DiagnosticReportV3 } from "@apps/obsidian/ui/diagnostics/report/types";
import { installObsidianDomHelpers, resetDom } from "../../helpers/domHarness";

describe("readable diagnostic report", () => {
  beforeEach(installObsidianDomHelpers);
  afterEach(resetDom);

  it("renders untrusted report values as text without dynamic HTML or styles", () => {
    const hostile = '<script>alert("x")</script>';
    const report = {
      schemaVersion: 4,
      question: hostile,
      findings: { summary: hostile, findings: [] },
      stats: { runId: "run-1", status: "failed" },
    } as unknown as DiagnosticReportV3;
    const container = document.body.createDiv();

    renderReadableDiagnosticReport(container, report);

    expect(container.shadowRoot).toBeNull();
    expect(container.querySelector("style")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain(hostile);
    expect(container.querySelector("details")?.textContent).toContain(hostile);
  });
});
