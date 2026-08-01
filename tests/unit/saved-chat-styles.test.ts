import { readStyles } from "../helpers/readStyles";

const styles = readStyles();

describe("saved chat styles", () => {
  it("keeps non-star actions hidden in History until the row is hovered or focused", () => {
    expect(
      cssRule(
        ".ixplorer-chat__saved-actions.has-favorite .ixplorer-chat__saved-action:not(.is-favorite)",
      ),
    ).toContain("display: none");
    expect(
      cssRule(
        ".ixplorer-chat__saved-row:hover .ixplorer-chat__saved-actions.has-favorite .ixplorer-chat__saved-action:not(.is-favorite)",
      ),
    ).toContain("display: inline-flex");
  });

  it("hides every action in Favorites until the row is hovered or focused", () => {
    expect(
      cssRule(
        ".ixplorer-chat__history-list.is-favorites .ixplorer-chat__saved-actions.has-favorite",
      ),
    ).toContain("opacity: 0");
    expect(
      cssRule(
        ".ixplorer-chat__history-list.is-favorites .ixplorer-chat__saved-row:hover .ixplorer-chat__saved-actions.has-favorite",
      ),
    ).toContain("opacity: 1");
  });
});

function cssRule(selector: string): string {
  const normalizedStyles = styles.replace(/\s+/g, " ");
  const normalizedSelector = selector.replace(/\s+/g, " ");
  return (
    Array.from(normalizedStyles.matchAll(/([^{}]+)\{([^}]*)\}/g)).find((match) =>
      match[1]
        .split(",")
        .map((candidate) => candidate.trim())
        .includes(normalizedSelector),
    )?.[2] ?? ""
  );
}
