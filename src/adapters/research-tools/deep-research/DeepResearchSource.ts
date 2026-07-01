// Deep-research data source. Contributes the `deep_search` tool, which lets the
// orchestrating model launch in-process research sub-agents. Kept separate from
// WebSource so it can be gated independently (it needs a DeepResearchRunner, not
// just a search provider).

import { Tool } from "../../../core/agent/tool";
import { DataSource, DataSourceDescriptor } from "@application/sources";
import { DeepResearchRunner } from "../../../application/research/deepResearchPort";
import { EvidenceRegistry } from "@application/sources";
import { DeepSearchTool } from "./DeepSearchTool";

export interface DeepResearchSourceOptions {
  runner: DeepResearchRunner;
  evidence: EvidenceRegistry;
  available?: boolean;
}

export class DeepResearchSource implements DataSource {
  readonly descriptor: DataSourceDescriptor;
  private readonly runner: DeepResearchRunner;
  private readonly evidence: EvidenceRegistry;

  constructor(options: DeepResearchSourceOptions) {
    this.runner = options.runner;
    this.evidence = options.evidence;
    this.descriptor = {
      id: "deep-research",
      kind: "deep-research",
      title: "Deep research",
      available: options.available ?? true,
    };
  }

  tools(): Tool[] {
    return [new DeepSearchTool({ runner: this.runner, evidence: this.evidence })];
  }
}
