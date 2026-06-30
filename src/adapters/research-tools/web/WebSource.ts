// Web data source (stage 1, task 5.2). Wraps a web search provider and
// contributes web search/fetch tools to the agent loop.

import { Tool } from "../../../core/agent/tool";
import { SearchProvider } from "../../../application/ports/web";
import { DataSource, DataSourceDescriptor } from "../../../application/sources/DataSource";
import { EvidenceRegistry } from "../../../application/sources/evidence";
import { WebSearchResearchTool } from "./WebSearchResearchTool";
import { WebFetchResearchTool } from "./WebFetchResearchTool";
import { WebFetchUrlTool } from "./WebFetchUrlTool";
import { WebFetchSectionTool } from "./WebFetchSectionTool";
import { WebPageMetadataTool } from "./WebPageMetadataTool";

export interface WebSourceOptions {
  provider: SearchProvider;
  evidence: EvidenceRegistry;
  available?: boolean;
}

export class WebSource implements DataSource {
  readonly descriptor: DataSourceDescriptor;
  private readonly provider: SearchProvider;
  private readonly evidence: EvidenceRegistry;

  constructor(options: WebSourceOptions) {
    this.provider = options.provider;
    this.evidence = options.evidence;
    this.descriptor = {
      id: "web",
      kind: "web",
      title: "Web research",
      available: options.available ?? true,
    };
  }

  tools(): Tool[] {
    const deps = { provider: this.provider, evidence: this.evidence };
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
