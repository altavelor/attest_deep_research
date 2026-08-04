import { readFileSync } from "fs";
import { resolve } from "path";
import styleModules from "../../src/apps/obsidian/styles.json";

export interface StyleModule {
  file: string;
  css: string;
}

export function readStyleModules(): StyleModule[] {
  return styleModules.map((file) => ({
    file,
    css: readFileSync(resolve(file), "utf8").trimEnd(),
  }));
}

export function readStyles(): string {
  return `${readStyleModules()
    .map((module) => module.css)
    .join("\n\n")}\n`;
}
