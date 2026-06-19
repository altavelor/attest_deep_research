import { readFileSync } from "fs";

const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

describe("diagnostic report modal styles", () => {
  it("keeps the app-level modal resizable in both dimensions", () => {
    expect(cssRule(".modal.ixplorer-chat__diagnostic-modal")).toContain("resize: both");
  });

  it("keeps the complete report scrollable with stable visible scrollbars", () => {
    const reportRule = cssRule(".ixplorer-chat__diagnostic-modal-report");

    expect(reportRule).toContain("overflow: scroll");
    expect(reportRule).toContain("scrollbar-gutter: stable");
    expect(styles).toContain(".ixplorer-chat__diagnostic-modal-report::-webkit-scrollbar");
  });
});

function cssRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}
