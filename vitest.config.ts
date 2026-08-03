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
      obsidian: resolve("tests/stubs/obsidian.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
