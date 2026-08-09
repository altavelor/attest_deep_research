import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@core": resolve("src/core"),
      "@application": resolve("src/application"),
      "@adapters": resolve("src/adapters"),
      "@apps": resolve("src/apps"),
      "@shared": resolve("src/shared"),
      "@manifest": resolve("manifest.json"),
      obsidian: resolve("tests/stubs/obsidian/index.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      all: true,
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        perFile: false,
        "src/core/**": { statements: 90, branches: 85, functions: 90, lines: 90 },
        "src/application/**": { statements: 86, branches: 76, functions: 86, lines: 86 },
        "src/adapters/**": { statements: 83, branches: 73, functions: 84, lines: 84 },
        "src/apps/**": { statements: 50, branches: 43, functions: 46, lines: 50 },
      },
    },
  },
});
