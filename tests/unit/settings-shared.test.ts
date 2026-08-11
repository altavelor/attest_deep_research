// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTranslator } from "@adapters/i18n";
import {
  createIconButton,
  formatEnrichmentStatus,
  formatIndexRowProgress,
  optionalNumber,
  renderCategoryHeading,
  renderModalActions,
  statusForProfile,
} from "@apps/obsidian/ui/settings/shared";
import { createContainer, installObsidianDomHelpers, resetDom } from "../helpers/domHarness";

const t = createTranslator("en").t;

describe("settings shared UI helpers", () => {
  beforeEach(installObsidianDomHelpers);
  afterEach(resetDom);

  it("formats chunk and file indexing progress", () => {
    const base = {
      status: "indexing" as const,
      scannedFiles: 3,
      totalFiles: 8,
      progress: 0.375,
      indexedFiles: 0,
      skippedFiles: 0,
      embeddedChunks: 0,
      deferredFiles: 0,
      failedFiles: 0,
      isStale: false,
    };

    expect(formatIndexRowProgress(t, { ...base, chunksTotal: 12, chunksEmbedded: 7 })).toBe(
      " · 7/12 chunks",
    );
    expect(formatIndexRowProgress(t, base)).toBe(" · 38% · 3/8 files");
  });

  it("reports active, completed, failed, and idle enrichment runs", () => {
    const base = { processed: 2, total: 4, extracted: 1, skipped: 0, failed: 0 };

    expect(
      formatEnrichmentStatus(t, {
        ...base,
        status: "running",
        currentSourcePath: "Papers/research.pdf",
        phase: "sections",
        sectionIndex: 3,
        sectionCount: 7,
      }),
    ).toBe("Enriching 2/4 · research.pdf · summarizing section 3/7");
    expect(formatEnrichmentStatus(t, { ...base, status: "done", failed: 2 })).toBe(
      "Metadata: 1 extracted, 0 up to date, 2 failed (4 sources)",
    );
    expect(formatEnrichmentStatus(t, { ...base, status: "error" })).toBe(
      "Metadata enrichment failed: unknown error",
    );
    expect(formatEnrichmentStatus(t, { ...base, status: "idle" })).toBe("");
  });

  it("formats each enrichment phase and default source-listing state", () => {
    const base = {
      status: "running" as const,
      processed: 0,
      total: 0,
      extracted: 0,
      skipped: 0,
      failed: 0,
    };

    expect(formatEnrichmentStatus(t, { ...base, phase: "metadata" })).toContain(
      "extracting metadata",
    );
    expect(formatEnrichmentStatus(t, { ...base, total: 1, phase: "sections" })).toContain(
      "summarizing sections",
    );
    expect(formatEnrichmentStatus(t, { ...base, phase: "document" })).toContain(
      "writing document summary",
    );
    expect(
      formatEnrichmentStatus(t, { ...base, phase: "claims", sectionIndex: 1, sectionCount: 2 }),
    ).toContain("extracting claims 1/2");
    expect(formatEnrichmentStatus(t, base)).toContain("listing sources");
  });

  it("renders accessible settings actions and parses optional numeric input", () => {
    const container = createContainer();
    const onClick = vi.fn();
    const onCancel = vi.fn();
    const onSave = vi.fn();

    renderCategoryHeading(container, "Models", "Choose a model");
    const button = createIconButton(container, {
      icon: "play",
      className: "run",
      label: "Run",
      onClick,
    });
    createIconButton(container, { icon: "stop", label: "Stop", disabled: true, onClick });
    renderModalActions(container, { t, onCancel, onSave, saveLabel: "Apply" });

    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".attest-settings__category-heading")?.textContent).toContain(
      "Models",
    );
    expect((container.querySelectorAll("button")[1] as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain("Apply");
    expect(optionalNumber(" ")).toBeUndefined();
    expect(optionalNumber("1,5")).toBe(1.5);
    expect(optionalNumber("invalid")).toBeUndefined();
  });

  it("shows suspension status only for suspended profiles", () => {
    expect(statusForProfile(t, { isSuspended: true, suspendedReason: "Invalid token" })).toEqual({
      kind: "is-suspended",
      label: "Suspended",
      title: "Invalid token",
    });
    expect(statusForProfile(t, { isSuspended: true })).toMatchObject({ title: "Suspended" });
    expect(statusForProfile(t, {})).toBeNull();
  });
});
