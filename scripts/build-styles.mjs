import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const modulesFile = resolve("src/apps/obsidian/styles.json");
const defaultOutputFile = resolve("dist/styles.css");

export async function readStyles() {
  const styleFiles = JSON.parse(await readFile(modulesFile, "utf8"));

  const sections = await Promise.all(
    styleFiles.map(async (file) => {
      const content = await readFile(resolve(file), "utf8");
      return content.trimEnd();
    }),
  );

  return `${sections.join("\n\n")}\n`;
}

export async function buildStyles(outputFile = defaultOutputFile) {
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, await readStyles());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildStyles(resolve(process.argv[2] ?? defaultOutputFile));
}
