import { readFileSync } from "fs";
import { resolve } from "path";

describe("index-search and debug-panel static policy", () => {
  it("keeps removed indexing controls out of the index-search surface", () => {
    const controller = readFileSync(
      resolve("src/apps/obsidian/ui/index/IndexSearchController.ts"),
      "utf8",
    );
    const panel = readFileSync(resolve("src/apps/obsidian/ui/index/IndexSearchPanel.ts"), "utf8");

    expect(controller).not.toContain("renderIndexControl");
    expect(controller).not.toContain("IndexControl");
    expect(panel).not.toContain("indexControlEl");
  });

  it("declares the alert role and list role on the index-search regions", () => {
    const panel = readFileSync(resolve("src/apps/obsidian/ui/index/IndexSearchPanel.ts"), "utf8");

    expect(panel).toContain('role: "alert"');
    expect(panel).toContain('role: "list"');
    expect(panel).toContain("ixplorer-index-search__warning");
  });
});
