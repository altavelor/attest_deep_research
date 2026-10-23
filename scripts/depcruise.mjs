#!/usr/bin/env node
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const TYPESCRIPT_API_PACKAGE = "@typescript/typescript6";
const CRUISER_PATH = "/node_modules/dependency-cruiser/";

/**
 * Maps a `typescript` import made by dependency-cruiser to the TypeScript 6
 * API package, because TypeScript 7 ships no JavaScript compiler API. Other
 * importers keep resolving the project's own compiler.
 */
export function cruiserTypeScriptSpecifier(specifier, parentURL) {
  const fromCruiser = parentURL?.includes(CRUISER_PATH) ?? false;
  if (!fromCruiser) return specifier;
  if (specifier !== "typescript" && !specifier.startsWith("typescript/")) return specifier;
  return TYPESCRIPT_API_PACKAGE + specifier.slice("typescript".length);
}

/**
 * Lists the reasons a cruise cannot be trusted as a layer check: a missing
 * TypeScript transpiler or a run that visited no modules passes silently
 * otherwise.
 */
export function untrustedCruiseReasons({ transpilers, totalCruised }) {
  const reasons = [];
  const typescript = transpilers.find((transpiler) => transpiler.name === "typescript");
  if (!typescript?.available) {
    reasons.push(
      `dependency-cruiser cannot load a TypeScript compiler API (${TYPESCRIPT_API_PACKAGE}).`,
    );
  }
  if (totalCruised === 0) {
    reasons.push("dependency-cruiser visited no modules, so no layer rule was checked.");
  }
  return reasons;
}

/** Runs dependency-cruiser over `src` with the repository configuration and returns the exit code. */
async function main() {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      return nextResolve(cruiserTypeScriptSpecifier(specifier, context.parentURL), context);
    },
  });
  const { cruise, format, getAvailableTranspilers } = await import("dependency-cruiser");
  const { default: extractDepcruiseOptions } =
    await import("dependency-cruiser/config-utl/extract-depcruise-options");
  const { default: extractTSConfig } =
    await import("dependency-cruiser/config-utl/extract-ts-config");

  const options = await extractDepcruiseOptions("./.dependency-cruiser.cjs");
  const tsConfig = extractTSConfig(options.tsConfig.fileName);
  const { output: result } = await cruise(["src"], options, undefined, { tsConfig });
  const report = await format(result, { outputType: "err" });
  process.stdout.write(report.output);

  const reasons = untrustedCruiseReasons({
    transpilers: getAvailableTranspilers(),
    totalCruised: result.summary.totalCruised,
  });
  for (const reason of reasons) process.stderr.write(`depcruise: ${reason}\n`);
  return reasons.length > 0 ? 1 : report.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
