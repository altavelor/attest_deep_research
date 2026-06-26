import { DiagnosticReportViewModel } from "./diagnosticFormatting";

export function renderReadableDiagnosticReport(
  container: HTMLElement,
  view: DiagnosticReportViewModel,
): void {
  container.empty();
  const header = container.createEl("header", { cls: "ixplorer-diagnostic-readable__header" });
  header.createEl("div", {
    cls: "ixplorer-diagnostic-readable__eyebrow",
    text: `Schema ${view.identity.schemaVersion}`,
  });
  header.createEl("h2", { text: view.title });
  header.createEl("p", {
    cls: "ixplorer-diagnostic-readable__outcome",
    text: `Status: ${view.outcome.status}${view.outcome.likelyLayer ? ` · Likely layer: ${view.outcome.likelyLayer}` : ""}`,
  });

  if (view.metrics.length > 0) {
    const metrics = container.createDiv({ cls: "ixplorer-diagnostic-readable__metrics" });
    for (const metric of view.metrics) {
      const item = metrics.createDiv({ cls: "ixplorer-diagnostic-readable__metric" });
      item.createSpan({ text: metric.label });
      item.createEl("strong", { text: metric.value });
    }
  }

  if (view.findings.length > 0) {
    const findings = createSection(container, "Findings", "findings");
    for (const finding of view.findings) {
      const item = findings.createDiv({
        cls: `ixplorer-diagnostic-readable__finding is-${finding.severity}`,
      });
      item.createEl("strong", { text: finding.code });
      item.createEl("p", { text: finding.message });
      item.createEl("small", { text: finding.likelyLayer });
    }
  }

  if (view.timeline.length > 0) {
    const timeline = createSection(container, "Timeline", "timeline").createEl("ol");
    for (const event of view.timeline) {
      const item = timeline.createEl("li");
      item.createEl("time", { text: `+${event.offsetMs} ms` });
      item.createEl("strong", { text: event.type });
      if (event.detail) item.createSpan({ text: event.detail });
    }
  }

  for (const section of view.sections) {
    const body = createSection(container, section.title, section.id).createEl("dl");
    for (const row of section.rows) {
      const item = body.createDiv();
      item.createEl("dt", { text: row.label });
      item.createEl("dd", { text: row.value });
    }
  }
}

function createSection(container: HTMLElement, title: string, id: string): HTMLElement {
  const section = container.createEl("section", {
    cls: "ixplorer-diagnostic-readable__section",
    attr: { "data-section-id": id },
  });
  section.createEl("h3", { text: title });
  return section;
}
