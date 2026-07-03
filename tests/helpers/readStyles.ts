import { readFileSync } from "fs";
import { resolve } from "path";
import styleModules from "../../src/apps/obsidian/styles.json";

export function readStyles(): string {
  return `${styleModules
    .map((file) => readFileSync(resolve(file), "utf8").trimEnd())
    .join("\n\n")}\n`;
}
