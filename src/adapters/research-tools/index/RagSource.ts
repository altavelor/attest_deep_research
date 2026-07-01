// RAG data source (stage 1, task 5.1). Wraps vault retrieval and contributes the
// index search tool to the agent loop.

import { Tool } from "@core/agent";
import { DataSource, DataSourceDescriptor } from "@application/sources";
import { IndexResearchTool } from "./IndexResearchTool";
import { INDEX_INVENTORY_TOOLS } from "./IndexInventoryTools";
import { CheckUrlsTool, ListIndexUrlsTool } from "./IndexUrlTools";
import { EvidenceRegistry } from "@application/sources";
import { ResearchRetriever, UrlStatusChecker } from "@application/contracts";

export interface RagSourceOptions {
  retriever: ResearchRetriever;
  urlStatusChecker?: UrlStatusChecker;
  indexSourcePaths?: readonly string[];
  evidence: EvidenceRegistry;
  available?: boolean;
}

export class RagSource implements DataSource {
  readonly descriptor: DataSourceDescriptor;
  private readonly retriever: ResearchRetriever;
  private readonly urlStatusChecker?: UrlStatusChecker;
  private readonly indexSourcePaths: readonly string[];
  private readonly evidence: EvidenceRegistry;

  constructor(options: RagSourceOptions) {
    this.retriever = options.retriever;
    this.urlStatusChecker = options.urlStatusChecker;
    this.indexSourcePaths = options.indexSourcePaths ?? [];
    this.evidence = options.evidence;
    this.descriptor = {
      id: "rag",
      kind: "rag",
      title: "Vault retrieval",
      available: options.available ?? true,
    };
  }

  tools(): Tool[] {
    return [
      new IndexResearchTool({ retriever: this.retriever, evidence: this.evidence }),
      ...INDEX_INVENTORY_TOOLS.map((InventoryTool) => new InventoryTool(this.retriever)),
      new ListIndexUrlsTool(this.retriever, { allowedSourcePaths: this.indexSourcePaths }),
      ...(this.urlStatusChecker ? [new CheckUrlsTool(this.urlStatusChecker)] : []),
    ];
  }
}
