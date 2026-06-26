// RAG data source (stage 1, task 5.1). Wraps vault retrieval and contributes the
// index search tool to the agent loop.

import { Tool } from "../../core/agent/tool";
import { DataSource, DataSourceDescriptor } from "./DataSource";
import { IndexResearchTool } from "./tools/IndexResearchTool";
import { EvidenceRegistry } from "./evidence";
import { ResearchRetriever } from "../contracts/research";

export interface RagSourceOptions {
  retriever: ResearchRetriever;
  evidence: EvidenceRegistry;
  available?: boolean;
}

export class RagSource implements DataSource {
  readonly descriptor: DataSourceDescriptor;
  private readonly retriever: ResearchRetriever;
  private readonly evidence: EvidenceRegistry;

  constructor(options: RagSourceOptions) {
    this.retriever = options.retriever;
    this.evidence = options.evidence;
    this.descriptor = {
      id: "rag",
      kind: "rag",
      title: "Vault retrieval",
      available: options.available ?? true,
    };
  }

  tools(): Tool[] {
    return [new IndexResearchTool({ retriever: this.retriever, evidence: this.evidence })];
  }
}
