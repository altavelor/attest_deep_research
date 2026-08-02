import { readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";

const SRC = resolve(__dirname, "..", "..", "src");

type Layer = "core" | "application" | "adapters" | "apps" | "ui" | "legacy";

/** Top-level dir under src/ -> layer. Anything not listed is "legacy" (pre-migration). */
function layerOfFile(absPath: string): Layer {
  const rel = relative(SRC, absPath);
  const parts = rel.split(/[\\/]/);

  if (parts.length === 1) return "apps";
  const top = parts[0];
  switch (top) {
    case "core":
      return "core";
    case "application":
      return "application";
    case "adapters":
      return "adapters";
    case "apps":
      return "apps";
    case "ui":
      return "ui";
    default:
      return "legacy";
  }
}

type Target =
  | { kind: "layer"; layer: Layer }
  | { kind: "obsidian" }
  | { kind: "node-builtin" }
  | { kind: "external" };

const NODE_BUILTINS = new Set(builtinModules);

function isNodeBuiltin(spec: string): boolean {
  const bare = spec.startsWith("node:") ? spec.slice("node:".length) : spec;

  return NODE_BUILTINS.has(bare) || NODE_BUILTINS.has(bare.split("/")[0]);
}

function classifyImport(fromFile: string, spec: string): Target {
  if (spec === "obsidian") return { kind: "obsidian" };
  if (isNodeBuiltin(spec)) return { kind: "node-builtin" };
  if (!spec.startsWith(".")) return { kind: "external" };
  const resolved = resolve(dirname(fromFile), spec);
  return { kind: "layer", layer: layerOfFile(resolved) };
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const IMPORT_RE = /(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']/g;
const BARE_IMPORT_RE = /import\s*["']([^"']+)["']/g;

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specs: string[] = [];
  for (const m of text.matchAll(IMPORT_RE)) specs.push(m[1]);
  for (const m of text.matchAll(BARE_IMPORT_RE)) specs.push(m[1]);
  return specs;
}

interface Violation {
  from: string;
  to: string;
  rule: string;
}

const FORBIDDEN_LAYER_IMPORTS: Partial<Record<Layer, Layer[]>> = {
  core: ["application", "adapters", "apps", "ui", "legacy"],
  application: ["adapters", "apps", "ui"],
};

const FORBIDDEN_BARE_IMPORTS: Partial<Record<Layer, Target["kind"][]>> = {
  core: ["obsidian", "node-builtin"],
  application: ["obsidian", "node-builtin"],
};

const UI_IMPORT_ALLOWLIST = new Set<string>([]);

function rel(file: string): string {
  return relative(SRC, file).split(/[\\/]/).join("/");
}

describe("architecture: import boundaries", () => {
  const files = listTsFiles(SRC);

  it("core/application do not import forbidden layers or platform modules", () => {
    const violations: Violation[] = [];
    for (const file of files) {
      const fromLayer = layerOfFile(file);
      const forbiddenLayers = FORBIDDEN_LAYER_IMPORTS[fromLayer] ?? [];
      const forbiddenBare = FORBIDDEN_BARE_IMPORTS[fromLayer] ?? [];
      for (const spec of importsOf(file)) {
        const target = classifyImport(file, spec);
        if (target.kind === "layer" && forbiddenLayers.includes(target.layer)) {
          violations.push({ from: rel(file), to: spec, rule: `${fromLayer} -> ${target.layer}` });
        } else if (target.kind !== "layer" && forbiddenBare.includes(target.kind)) {
          violations.push({ from: rel(file), to: spec, rule: `${fromLayer} -> ${target.kind}` });
        }
      }
    }
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("only ui/apps import ui (with shrinking baseline allowlist)", () => {
    const violations: Violation[] = [];
    for (const file of files) {
      const fromLayer = layerOfFile(file);
      if (fromLayer === "ui" || fromLayer === "apps") continue;
      for (const spec of importsOf(file)) {
        const target = classifyImport(file, spec);
        if (target.kind === "layer" && target.layer === "ui") {
          if (UI_IMPORT_ALLOWLIST.has(rel(file))) continue;
          violations.push({ from: rel(file), to: spec, rule: `${fromLayer} -> ui` });
        }
      }
    }
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("baseline allowlist entries still exist (remove stale entries as files migrate)", () => {
    const fileSet = new Set(files.map(rel));
    const stale = [...UI_IMPORT_ALLOWLIST].filter((p) => !fileSet.has(p));
    expect(stale, `Stale allowlist entries: ${stale.join(", ")}`).toEqual([]);
  });
});
