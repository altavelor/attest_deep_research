import { readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { describe, expect, it } from "vitest";

import { createResearchToolRegistry } from "@adapters/research-tools";
import type { ChatToolDefinition } from "@core/agent";

/**
 * Every tool the model can see, with every capability switched on. A tool that
 * only registers under some availability flag would otherwise escape the audit.
 */
function allToolDefinitions(): ChatToolDefinition[] {
  const retriever = new Proxy(
    {},
    { get: () => async () => ({ chunks: [], citations: [], items: [] }) },
  );
  const provider = {
    search: async () => [],
    fetchPage: async () => ({ ok: true }),
    fetchMetadata: async () => ({ ok: true }),
    fetchDocument: async () => ({ ok: true }),
  };
  const noteTools = {
    setCitationProvider: () => {},
    definitions: () => [],
    mutationEnabled: () => true,
    execute: async () => ({ ok: true, result: "" }),
  };

  return createResearchToolRegistry({
    retriever,
    searchProvider: provider,
    noteTools,
    urlStatusChecker: { checkUrls: async () => [] },
    subAgentRunner: () => {},
    vaultWriter: { write: async () => {} },
    imageSearch: { enabledImageSources: () => [] },
    documentImageCandidates: async () => [],
    availability: {
      searchMode: "indexAndWeb",
      noteAccess: true,
      activeFileAccess: true,
      noteMutationAccess: true,
      retrieverAvailable: true,
      webProviderAvailable: true,
    },
  } as never).tools.definitions();
}

interface JsonSchemaProperty {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  maxItems?: number;
  items?: JsonSchemaProperty;
}

function propertiesOf(definition: ChatToolDefinition): Record<string, JsonSchemaProperty> {
  const parameters = definition.function.parameters as { properties?: unknown } | undefined;
  return (parameters?.properties ?? {}) as Record<string, JsonSchemaProperty>;
}

function parametersOf(definition: ChatToolDefinition): Record<string, unknown> {
  return (definition.function.parameters ?? {}) as Record<string, unknown>;
}

describe("model-facing tool schemas", () => {
  const definitions = allToolDefinitions();
  const named = definitions.map((definition) => [definition.function.name, definition] as const);

  it("audits the whole toolset", () => {
    expect(definitions.length).toBeGreaterThanOrEqual(30);
  });

  it.each(named)("%s: describes itself and every property", (name, definition) => {
    expect(definition.function.description?.trim(), name).toBeTruthy();
    for (const [property, schema] of Object.entries(propertiesOf(definition))) {
      expect(schema.description?.trim(), `${name}.${property}`).toBeTruthy();
    }
  });

  it.each(named)("%s: bounds every property the model can fill", (name, definition) => {
    for (const [property, schema] of Object.entries(propertiesOf(definition))) {
      const where = `${name}.${property}`;
      if (schema.type === "integer" || schema.type === "number") {
        expect(schema.minimum, where).toBeDefined();
        expect(schema.maximum, where).toBeDefined();
      }
      if (schema.type === "array") {
        expect(schema.maxItems, where).toBeDefined();
      }
    }
  });

  it.each(named)("%s: rejects undeclared properties and declares what it requires", (name, def) => {
    const parameters = parametersOf(def);
    expect(parameters.type, name).toBe("object");
    expect(parameters.additionalProperties, name).toBe(false);
    const declared = Object.keys(propertiesOf(def));
    for (const required of (parameters.required as string[] | undefined) ?? []) {
      expect(declared, `${name}.${required}`).toContain(required);
    }
  });
});

describe("custom parsers stay in step with their schema", () => {
  function toolSources(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return toolSources(path);
      return entry.name.endsWith(".ts") ? [path] : [];
    });
  }

  const files = toolSources(resolve("src/adapters/research-tools"))
    .map((path) => ({ path, source: readFileSync(path, "utf8") }))
    .filter((file) => file.source.includes("  parse:"));

  /**
   * Fields a hand-written parser accepts: read directly off `input`, or named in
   * an allow-list literal. `present_chart` used the second form, which is why the
   * first version of this guard missed the very defect it was written for.
   */
  function allowListKeys(parse: string): string[] {
    const keys: string[] = [];
    for (const collection of parse.matchAll(/(?:new Set\(|=\s*)\[([^\]]*)\]/g)) {
      keys.push(...[...collection[1]!.matchAll(/"(\w+)"/g)].map((match) => match[1]!));
    }
    keys.push(...[...parse.matchAll(/key\s*!==\s*"(\w+)"/g)].map((match) => match[1]!));
    return keys;
  }

  it("finds the tools that parse their own input", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((file) => [file.path, file] as const))(
    "%s: reads no argument its schema omits",
    (path, file) => {
      for (const tool of file.source.matchAll(/defineTool<[\s\S]*?>\(\{([\s\S]*?)\n\}\);/g)) {
        const body = tool[1]!;
        const schema = /schema:\s*\{([\s\S]*?)\n  \},/.exec(body);
        const parse = /\n  parse:[\s\S]*?\n  \},\n/.exec(body);
        if (!schema || !parse) continue;
        const name = /name:\s*([\w.]+)/.exec(body)?.[1] ?? path;
        const declared = [...schema[1]!.matchAll(/^\s{4}(\w+):/gm)].map((match) => match[1]!);
        const read = [
          ...[...parse[0].matchAll(/\binput\.(\w+)\b/g)].map((match) => match[1]!),
          ...allowListKeys(parse[0]),
        ];
        for (const property of new Set(read)) {
          expect(declared, `${name}: parser reads "${property}"`).toContain(property);
        }
      }
    },
  );
});
