// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import { readStyleModules } from "../helpers/readStyles";
import { renderStyleCatalogue } from "../helpers/styleCatalogue";
import { resetDom } from "../helpers/domHarness";

const STYLED_CLASS_PREFIX = "ixplorer-";

const UNSTYLED_QUERY_HOOKS: Record<string, string> = {
  "ixplorer-chat__workflow-node--complete": "Tool-status marker read by transcript queries.",
  "ixplorer-chat__workflow-node--finalizing": "Finalizing marker read by transcript queries.",
  "ixplorer-chat__workflow-node--thinking": "Reasoning marker read by transcript queries.",
  "ixplorer-chat__workflow-node--tool": "Tool marker read by transcript queries.",
  "ixplorer-settings-advanced__content": "Advanced block anchor with no own styling.",
  "ixplorer-settings-websource-table": "Web-source table anchor with no own styling.",
  "ixplorer-settings__gated-section": "Gate wrapper whose children carry the styling.",
};

const COMPONENTS_WITHOUT_A_BEHAVIOURAL_SURFACE = [
  "ixplorer-artifact",
  "ixplorer-artifacts",
  "ixplorer-chart",
  "ixplorer-chat-view",
  "ixplorer-context-picker",
  "ixplorer-gallery",
  "ixplorer-index-path-picker",
  "ixplorer-index-path-summary",
  "ixplorer-index-report",
  "ixplorer-index-run",
  "ixplorer-lightbox",
  "ixplorer-profile-modal",
  "ixplorer-root",
  "ixplorer-settings-index-table",
  "ixplorer-websource-modal",
].sort();

function componentOf(className: string): string {
  return className.split(/__|--/)[0];
}

function declaredClasses(css: string): Set<string> {
  const selectors = css.replace(/\{[^}]*\}/g, "\n");
  const declared = new Set<string>();
  for (const match of selectors.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
    if (match[1].startsWith(STYLED_CLASS_PREFIX)) declared.add(match[1]);
  }
  return declared;
}

const modules = readStyleModules();
const declared = new Set(modules.flatMap((module) => [...declaredClasses(module.css)]));
const rendered = renderStyleCatalogue();
const renderedStyled = [...rendered].filter((name) => name.startsWith(STYLED_CLASS_PREFIX)).sort();
const queryHooks = Object.keys(UNSTYLED_QUERY_HOOKS);

afterEach(() => {
  resetDom();
});

describe("stylesheet class contract", () => {
  it("applies only classes the built stylesheet declares", () => {
    expect(renderedStyled.length).toBeGreaterThan(50);
    expect(
      renderedStyled.filter((name) => !declared.has(name) && !queryHooks.includes(name)),
    ).toEqual([]);
  });

  it("keeps every query-hook exemption justified, applied, and unstyled", () => {
    expect(queryHooks.length).toBeLessThanOrEqual(10);
    expect(Object.values(UNSTYLED_QUERY_HOOKS).filter((reason) => reason.length < 20)).toEqual([]);
    expect(queryHooks.filter((name) => !rendered.has(name))).toEqual([]);
    expect(queryHooks.filter((name) => declared.has(name))).toEqual([]);
  });

  it("lists exactly the components no behavioural test renders", () => {
    const renderedComponents = new Set([...rendered].map(componentOf));
    const unrendered = [...declared].filter((name) => !rendered.has(name));
    const unrenderedComponents = [
      ...new Set(
        unrendered.map(componentOf).filter((component) => !renderedComponents.has(component)),
      ),
    ].sort();
    const report = Object.fromEntries(
      unrenderedComponents.map((component) => [
        component,
        unrendered.filter((name) => componentOf(name) === component).sort(),
      ]),
    );

    expect(unrenderedComponents, JSON.stringify(report, null, 2)).toEqual(
      COMPONENTS_WITHOUT_A_BEHAVIOURAL_SURFACE,
    );
  });
});
