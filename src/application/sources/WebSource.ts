// Web data source (stage 1, task 5.2). Wraps a web search provider and
// contributes web search/fetch tools to the agent loop.

import { Tool } from "../../core/agent/tool";
import { SearchProvider } from "../ports/web";
import { DataSource, DataSourceDescriptor } from "./DataSource";
import { EvidenceRegistry } from "./evidence";
import { WebSearchResearchTool } from "./tools/WebSearchResearchTool";
import { WebFetchResearchTool } from "./tools/WebFetchResearchTool";

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
    const tools: Tool[] = [
      new WebSearchResearchTool({ provider: this.provider, evidence: this.evidence }),
    ];
    if (this.provider.fetchPage) {
      tools.push(new WebFetchResearchTool({ provider: this.provider, evidence: this.evidence }));
    }
    return tools;
  }
}
