// RAG data source (stage 1, task 5.1). Wraps vault retrieval and contributes the
// index search tool to the agent loop.

import { Tool } from "../../core/agent/tool";
import { DataSource, DataSourceDescriptor } from "./DataSource";
import { IndexResearchTool } from "./tools/IndexResearchTool";
import {
  FindInIndexTool,
  GetIndexSourceOutlineTool,
  ListIndexChunksTool,
  ListIndexSourcesTool,
  ReadIndexChunkTool,
  SearchIndexByMetadataTool,
  SummarizeIndexSourceTool,
} from "./tools/IndexInventoryTools";
import { CheckUrlsTool, ListIndexUrlsTool } from "./tools/IndexUrlTools";
import { EvidenceRegistry } from "./evidence";
import { ResearchRetriever, UrlStatusChecker } from "../contracts/research";

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
      new ListIndexSourcesTool(this.retriever),
      new ListIndexChunksTool(this.retriever),
      new ReadIndexChunkTool(this.retriever),
      new FindInIndexTool(this.retriever),
      new SummarizeIndexSourceTool(this.retriever),
      new GetIndexSourceOutlineTool(this.retriever),
      new SearchIndexByMetadataTool(this.retriever),
      new ListIndexUrlsTool(this.retriever, { allowedSourcePaths: this.indexSourcePaths }),
      ...(this.urlStatusChecker ? [new CheckUrlsTool(this.urlStatusChecker)] : []),
    ];
  }
}
