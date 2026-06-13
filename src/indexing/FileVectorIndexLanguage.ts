import { LanguageInventoryItem } from "../shared/types";
import { detectTextLanguages, languageInventoryFromSources } from "./languageDetection";
import type { FileVectorIndexState } from "./FileVectorIndexState";
import { sourcePathFromReference } from "./FileVectorIndexVector";

export function languageInventoryFromStoredChunks(
  state: FileVectorIndexState,
): LanguageInventoryItem[] {
  const bySourcePath = new Map<string, { text: string[]; chunkCount: number }>();

  for (const chunks of state.chunksByShard.values()) {
    for (const chunk of chunks) {
      const sourcePath = chunk.row.sourcePath ?? sourcePathFromReference(chunk.row.source);
      const source = bySourcePath.get(sourcePath) ?? { text: [], chunkCount: 0 };
      source.text.push(chunk.row.text);
      source.chunkCount += 1;
      bySourcePath.set(sourcePath, source);
    }
  }

  return languageInventoryFromSources(
    Array.from(bySourcePath.values()).map((source) => ({
      languages: detectTextLanguages(source.text.join("\n\n")),
      chunkCount: source.chunkCount,
    })),
  );
}
