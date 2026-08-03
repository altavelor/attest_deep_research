import { SourceReference } from "./source";

export interface Citation {
  id: string;
  source: SourceReference;
  label: string;
}

export type LanguageCode = string;

export interface LanguageInventoryItem {
  language: LanguageCode;
  chunkCount: number;
  sourceCount: number;
}
