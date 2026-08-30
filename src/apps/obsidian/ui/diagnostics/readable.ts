import { DiagnosticReportV3 } from "./report/types";

const SECTION_KEYS = [
  "findings",
  "model",
  "preflight",
  "request",
  "reasoning",
  "answer",
  "stats",
] as const;

/** Renders diagnostics with text-only DOM operations so report data never becomes markup. */
export function renderReadableDiagnosticReport(
  container: HTMLElement,
  report: DiagnosticReportV3,
): void {
  container.empty();
  const root = container.createDiv({ cls: "dr-root" });
  root.createEl("h2", { text: "Diagnostic report" });
  root.createEl("p", {
    cls: "dr-question-text",
    text: report.question || "No question recorded",
  });
  root.createEl("p", {
    cls: "dr-schema-version",
    text: `Schema version ${report.schemaVersion}`,
  });

  for (const key of SECTION_KEYS) renderGroup(root, labelFor(key), report[key], true);
}

function renderGroup(parent: HTMLElement, label: string, value: unknown, open = false): void {
  const details = parent.createEl("details", { cls: "dr-tree-group" });
  details.open = open;
  details.createEl("summary", { text: label });
  renderValue(details.createDiv({ cls: "dr-tree-group-body" }), value);
}

function renderValue(parent: HTMLElement, value: unknown): void {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      parent.createSpan({ cls: "dr-empty-value", text: "Empty" });
      return;
    }
    value.forEach((item, index) => renderGroup(parent, `Item ${index + 1}`, item));
    return;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      parent.createSpan({ cls: "dr-empty-value", text: "Empty" });
      return;
    }
    const list = parent.createEl("dl", { cls: "dr-tree-fields" });
    for (const [key, field] of entries) {
      const row = list.createDiv({
        cls: `dr-tree-field${isComposite(field) ? " dr-tree-field-nested" : ""}`,
      });
      if (isComposite(field)) {
        renderGroup(row, labelFor(key), field);
      } else {
        row.createEl("dt", { text: labelFor(key) });
        row.createEl("dd", { text: displayValue(field) });
      }
    }
    return;
  }

  parent.createSpan({ text: displayValue(value) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isComposite(value: unknown): boolean {
  return Array.isArray(value) || isRecord(value);
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "symbol") return value.description ?? "Symbol";
  return "Unsupported value";
}

function labelFor(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
