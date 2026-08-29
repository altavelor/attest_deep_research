import { readFile } from "fs/promises";
import { resolve } from "path";
import process from "process";

/**
 * Fails when the built plugin bundle still reaches for Node built-ins. Obsidian
 * Mobile runs the bundle in a browser runtime with no `require`, so a single
 * such reference stops the plugin from loading at all.
 *
 * This guards the bundle against load-time failures. Source-level rules for
 * plugin code, including the Node-only `Buffer` global, live in
 * tests/arch/import-boundaries.test.ts.
 */

const FORBIDDEN_MODULES = [
  "assert",
  "buffer",
  "child_process",
  "crypto",
  "dns",
  "fs",
  "fs/promises",
  "http",
  "https",
  "net",
  "os",
  "path",
  "readline",
  "stream",
  "tls",
  "url",
  "util",
  "worker_threads",
  "zlib",
];

const bundlePath = resolve(process.env.ATTEST_OUTPUT_DIR ?? "dist", "main.js");
const maxBundleBytes = Number(process.env.ATTEST_MAX_BUNDLE_BYTES ?? 3_750_000);

let bundle;
try {
  bundle = await readFile(bundlePath, "utf8");
} catch (error) {
  console.error(`Bundle check failed: could not read ${bundlePath}.`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const failures = [];

if (Buffer.byteLength(bundle, "utf8") > maxBundleBytes) {
  failures.push(
    `bundle is ${Buffer.byteLength(bundle, "utf8")} bytes (budget: ${maxBundleBytes} bytes)`,
  );
}

for (const moduleName of FORBIDDEN_MODULES) {
  const pattern = new RegExp(
    `require\\(\\s*["'](?:node:)?${moduleName.replace("/", "\\/")}["']\\s*\\)`,
    "g",
  );
  const matches = bundle.match(pattern);

  if (matches) {
    failures.push(`require("${moduleName}") appears ${matches.length}x`);
  }
}

if (failures.length > 0) {
  console.error(`Bundle check failed for ${bundlePath}:`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error("\nNode built-ins are unavailable on Obsidian Mobile.");
  console.error("Route the dependency through a port in src/application/ports/ instead.");
  process.exit(1);
}

console.log(`Bundle check passed: no Node built-ins in ${bundlePath}.`);
