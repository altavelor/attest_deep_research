import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Aliases mirror tsconfig.json "paths" and esbuild.config.mjs so tests resolve
// the same "@core/*" specifiers as tsc and the production bundle.
export default defineConfig({
  resolve: {
    alias: {
      "@core": resolve("src/core"),
      "@application": resolve("src/application"),
      "@adapters": resolve("src/adapters"),
      "@apps": resolve("src/apps"),
      "@shared": resolve("src/shared"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
