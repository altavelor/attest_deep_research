// Web data source (stage 1, task 5.2). Wraps a web search provider and
// contributes web search/fetch tools to the agent loop.

import { Tool } from "@core/agent";
import { SearchProvider } from "@application/ports";
import { DataSource, DataSourceDescriptor } from "@application/sources";
import { EvidenceRegistry } from "@application/sources";
import { WebSearchResearchTool } from "./WebSearchResearchTool";
import { WebFetchResearchTool } from "./WebFetchResearchTool";
import { WebFetchUrlTool } from "./WebFetchUrlTool";
import { WebFetchSectionTool } from "./WebFetchSectionTool";
import { WebPageMetadataTool } from "./WebPageMetadataTool";
import { AnswerArtifactRegistry } from "../media/AnswerArtifactRegistry";

export interface WebSourceOptions {
  provider: SearchProvider;
  evidence: EvidenceRegistry;
  /** Collects image candidates referenced by fetched pages. */
  artifacts?: AnswerArtifactRegistry;
  available?: boolean;
}

export class WebSource implements DataSource {
  readonly descriptor: DataSourceDescriptor;
  private readonly provider: SearchProvider;
  private readonly evidence: EvidenceRegistry;
  private readonly artifacts?: AnswerArtifactRegistry;

  constructor(options: WebSourceOptions) {
    this.provider = options.provider;
    this.evidence = options.evidence;
    this.artifacts = options.artifacts;
    this.descriptor = {
      id: "web",
      kind: "web",
      title: "Web research",
      available: options.available ?? true,
    };
  }

  tools(): Tool[] {
    const deps = {
      provider: this.provider,
      evidence: this.evidence,
      ...(this.artifacts ? { artifacts: this.artifacts } : {}),
    };
    const tools: Tool[] = [new WebSearchResearchTool(deps)];
    if (this.provider.fetchPage) {
      tools.push(
        new WebFetchResearchTool(deps),
        new WebFetchUrlTool(deps),
        new WebFetchSectionTool(deps),
      );
    }
    if (this.provider.fetchMetadata) {
      tools.push(new WebPageMetadataTool({ provider: this.provider }));
    }
    return tools;
  }
}
