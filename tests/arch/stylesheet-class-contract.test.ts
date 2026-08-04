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
];

const UNSTYLED_RENDER_HOOKS = [
  "ixplorer-chat__workflow-node--complete",
  "ixplorer-chat__workflow-node--finalizing",
  "ixplorer-chat__workflow-node--thinking",
  "ixplorer-chat__workflow-node--tool",
  "ixplorer-settings-advanced__content",
  "ixplorer-settings-websource-table",
  "ixplorer-settings__gated-section",
];

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

afterEach(() => {
  resetDom();
});

describe("stylesheet class contract", () => {
  it("applies only classes the built stylesheet declares", () => {
    expect(renderedStyled.length).toBeGreaterThan(50);
    expect(
      renderedStyled.filter((name) => !declared.has(name) && !UNSTYLED_RENDER_HOOKS.includes(name)),
    ).toEqual([]);
  });

  it("ships no stylesheet module whose classes no renderer applies", () => {
    const unrenderedModules = modules
      .filter((module) => !MODULES_WITHOUT_A_CATALOGUE_SURFACE.includes(module.file))
      .filter((module) => ![...declaredClasses(module.css)].some((name) => rendered.has(name)))
      .map((module) => module.file);

    expect(unrenderedModules).toEqual([]);
  });
});

console.info(
  `Stylesheet classes the render catalogue never applies: ${
    [...declared].filter((name) => !rendered.has(name)).sort().length
  } of ${declared.size}.`,
);
