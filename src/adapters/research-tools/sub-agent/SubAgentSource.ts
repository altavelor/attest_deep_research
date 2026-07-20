// Universal sub-agent data source. Contributes the `run_subagent` tool, which lets
// the orchestrating model launch in-process sub-agents with the same read-only
// toolset it has for the current turn. Kept separate from WebSource/RagSource so
// it can be gated independently (it needs a SubAgentPort, not just a provider).

import { Tool } from "@core/agent";
import { DataSource, DataSourceDescriptor } from "@application/sources";
import { ResearchToolsetOptions, SubAgentPort } from "@application/research";
import { EvidenceRegistry } from "@application/sources";
import { SubAgentTool } from "./SubAgentTool";

export interface SubAgentSourceOptions {
  runner: SubAgentPort;
  evidence: EvidenceRegistry;
  /** The current turn's tool availability + collaborators, handed to every sub-agent session. */
  toolContext: ResearchToolsetOptions;
  available?: boolean;
}

export class SubAgentSource implements DataSource {
  readonly descriptor: DataSourceDescriptor;
  private readonly runner: SubAgentPort;
  private readonly evidence: EvidenceRegistry;
  private readonly toolContext: ResearchToolsetOptions;

  constructor(options: SubAgentSourceOptions) {
    this.runner = options.runner;
    this.evidence = options.evidence;
    this.toolContext = options.toolContext;
    this.descriptor = {
      id: "sub-agent",
      kind: "sub-agent",
      title: "Sub-agent",
      available: options.available ?? true,
    };
  }

  tools(): Tool[] {
    return [
      new SubAgentTool({
        runner: this.runner,
        evidence: this.evidence,
        toolContext: this.toolContext,
      }),
    ];
  }
}
