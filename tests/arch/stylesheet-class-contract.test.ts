// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import { readStyleModules } from "../helpers/readStyles";
import { renderStyleCatalogue } from "../helpers/styleCatalogue";
import { resetDom } from "../helpers/domHarness";

const STYLED_CLASS_PREFIX = "ixplorer-";

const MODULES_WITHOUT_A_CATALOGUE_SURFACE = [
  "src/apps/obsidian/ui/settings/profile-modal.css",
  "src/apps/obsidian/ui/chat/chat-shell.css",
  "src/apps/obsidian/ui/chat/chat-transcript.css",
  "src/apps/obsidian/ui/diagnostics/modal.css",
  "src/apps/obsidian/ui/chat/assistant-content.css",
  "src/apps/obsidian/ui/chat/chat-composer.css",
  "src/apps/obsidian/ui/chat/citations/citations.css",
  "src/apps/obsidian/ui/chat/artifacts/artifacts.css",
  "src/apps/obsidian/ui/chat/context/document-picker.css",
].sort();

const UNSTYLED_QUERY_HOOKS: Record<string, string> = {
  "ixplorer-chat__workflow-node--complete": "Tool-status marker read by transcript queries.",
  "ixplorer-chat__workflow-node--finalizing": "Finalizing marker read by transcript queries.",
  "ixplorer-chat__workflow-node--thinking": "Reasoning marker read by transcript queries.",
  "ixplorer-chat__workflow-node--tool": "Tool marker read by transcript queries.",
  "ixplorer-settings-advanced__content": "Advanced block anchor with no own styling.",
  "ixplorer-settings-websource-table": "Web-source table anchor with no own styling.",
  "ixplorer-settings__gated-section": "Gate wrapper whose children carry the styling.",
};

const DECLARED_CLASSES_WITHOUT_A_RENDERER: Record<string, number> = {
  "src/apps/obsidian/ui/chat/artifacts/artifacts.css": 33,
  "src/apps/obsidian/ui/chat/assistant-content.css": 5,
  "src/apps/obsidian/ui/chat/chat-composer.css": 24,
  "src/apps/obsidian/ui/chat/chat-shell.css": 9,
  "src/apps/obsidian/ui/chat/chat-transcript.css": 20,
  "src/apps/obsidian/ui/chat/citations/citations.css": 11,
  "src/apps/obsidian/ui/chat/context/document-picker.css": 11,
  "src/apps/obsidian/ui/chat/history/saved-chats.css": 4,
  "src/apps/obsidian/ui/chat/workflow.css": 21,
  "src/apps/obsidian/ui/diagnostics/modal.css": 6,
  "src/apps/obsidian/ui/index/index-search.css": 1,
  "src/apps/obsidian/ui/settings/profile-modal.css": 10,
  "src/apps/obsidian/ui/settings/settings.css": 51,
  "src/apps/obsidian/ui/settings/web-sources.css": 6,
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

  it("lists exactly the stylesheet modules no catalogue surface renders", () => {
    const unrenderedModules = modules
      .filter((module) => ![...declaredClasses(module.css)].some((name) => rendered.has(name)))
      .map((module) => module.file)
      .sort();

    expect(unrenderedModules).toEqual(MODULES_WITHOUT_A_CATALOGUE_SURFACE);
  });

  it("names every declared class no renderer applies, per stylesheet module", () => {
    const unrendered: Record<string, string[]> = {};
    for (const module of modules) {
      const names = [...declaredClasses(module.css)].filter((name) => !rendered.has(name)).sort();
      if (names.length > 0) unrendered[module.file] = names;
    }

    const counts = Object.fromEntries(
      Object.entries(unrendered).map(([file, names]) => [file, names.length]),
    );

    expect(counts, JSON.stringify(unrendered, null, 2)).toEqual(
      DECLARED_CLASSES_WITHOUT_A_RENDERER,
    );
  });
});
