import { RetrievalResult } from "../retrieval/RetrievalService";
import {
  LanguageInventoryItem,
  ResearchAnswer,
  RetrievalOptions,
  RetrievalQueryVariant,
} from "../shared/types";
import { ResearchChatHistoryMessage } from "./prompts";

export interface ResearchRetriever {
  search(query: string, options: RetrievalOptions): Promise<RetrievalResult>;
  getLanguageInventory?(): Promise<LanguageInventoryItem[]>;
}

export type ResearchSearchMode = "indexOnly" | "indexAndWeb" | "webOnly";

export interface ResearchRequest {
  question: string;
  includeWebSearch?: boolean;
  searchMode?: ResearchSearchMode;
  contextPaths?: string[];
  deepResearch?: boolean;
  chatHistory?: ResearchChatHistoryMessage[];
}

export type ResearchStreamEvent =
  | { type: "status"; message: string }
  | { type: "delta"; content: string }
  | { type: "complete"; answer: ResearchAnswer };

export type VaultQueryVariants = RetrievalQueryVariant[] | undefined;
