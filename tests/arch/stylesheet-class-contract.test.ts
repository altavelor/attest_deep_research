// @vitest-environment happy-dom

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readStyleModules } from "../helpers/readStyles";
import { renderStyleCatalogue } from "../helpers/styleCatalogue";
import { resetDom } from "../helpers/domHarness";

const STYLED_CLASS_PREFIX = "attest-";
const REPORT_DIRECTORY = "coverage";

const UNSTYLED_QUERY_HOOKS: Record<string, string> = {
  "attest-chat__workflow-node--complete": "Tool-status marker read by transcript queries.",
  "attest-chat__workflow-node--finalizing": "Finalizing marker read by transcript queries.",
  "attest-chat__workflow-node--thinking": "Reasoning marker read by transcript queries.",
  "attest-chat__workflow-node--tool": "Tool marker read by transcript queries.",
  "attest-settings-advanced__content": "Advanced block anchor with no own styling.",
  "attest-settings-websource-table": "Web-source table anchor with no own styling.",
  "attest-settings__gated-section": "Gate wrapper whose children carry the styling.",
};

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

  it("reports every declared class no renderer applies, grouped by stylesheet module", () => {
    const report: Record<string, string[]> = {};
    for (const module of modules) {
      const names = [...declaredClasses(module.css)].filter((name) => !rendered.has(name)).sort();
      if (names.length > 0) report[module.file] = names;
    }
    const total = Object.values(report).reduce((sum, names) => sum + names.length, 0);

    mkdirSync(resolve(REPORT_DIRECTORY), { recursive: true });
    writeFileSync(
      resolve(REPORT_DIRECTORY, "unrendered-style-classes.json"),
      `${JSON.stringify({ total, byModule: report }, null, 2)}\n`,
    );

    const written = JSON.parse(
      readFileSync(resolve(REPORT_DIRECTORY, "unrendered-style-classes.json"), "utf8"),
    ) as { total: number; byModule: Record<string, string[]> };
    const listed = Object.values(written.byModule).flat();

    expect(written.total).toBe(listed.length);
    expect(listed.filter((name) => !declared.has(name) || rendered.has(name))).toEqual([]);
  });
});
