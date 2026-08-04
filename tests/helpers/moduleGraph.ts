import { readFileSync, readdirSync, statSync } from "fs";
import { posix, resolve } from "path";

const ALIASES: Record<string, string> = {
  "@core": "src/core",
  "@application": "src/application",
  "@adapters": "src/adapters",
  "@apps": "src/apps",
  "@shared": "src/shared",
};

const SPECIFIER_PATTERN = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

export function listSourceModules(root = "src"): string[] {
  const modules: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = posix.join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) modules.push(path);
    }
  };
  walk(root);
  return modules.sort();
}

function resolveModule(specifier: string, fromModule: string): string | undefined {
  let target: string | undefined;
  const aliasKey = Object.keys(ALIASES).find(
    (alias) => specifier === alias || specifier.startsWith(`${alias}/`),
  );
  if (aliasKey) {
    target =
      specifier === aliasKey ? ALIASES[aliasKey] : specifier.replace(aliasKey, ALIASES[aliasKey]);
  } else if (specifier.startsWith(".")) {
    target = posix.join(posix.dirname(fromModule), specifier);
  }
  if (!target) return undefined;

  const withoutExtension = target.replace(/\.js$/, "");
  for (const candidate of [
    withoutExtension,
    `${withoutExtension}.ts`,
    posix.join(withoutExtension, "index.ts"),
  ]) {
    if (!candidate.endsWith(".ts")) continue;
    try {
      if (statSync(resolve(candidate)).isFile()) return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

export function readImports(module: string): string[] {
  const source = readFileSync(resolve(module), "utf8");
  const imports = new Set<string>();
  for (const match of source.matchAll(SPECIFIER_PATTERN)) {
    const resolved = resolveModule(match[1], module);
    if (resolved) imports.add(resolved);
  }
  return [...imports];
}

/** Walks the import graph from the given entry modules and returns every module it reaches. */
export function reachableModules(entryPoints: string[]): Set<string> {
  const reached = new Set<string>();
  const queue = [...entryPoints];
  while (queue.length > 0) {
    const module = queue.pop() as string;
    if (reached.has(module)) continue;
    reached.add(module);
    queue.push(...readImports(module));
  }
  return reached;
}
