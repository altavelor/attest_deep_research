import { Tool } from "@core/agent";
import { DataSource, DataSourceDescriptor } from "@application/sources";
import type { SubAgentDelegator, SubAgentParentRun } from "@application/ports/subAgent";
import { EvidenceRegistry } from "@application/sources";
import { SubAgentResultTool, SubAgentWaitTool } from "./SubAgentResultTools";
import { SubAgentTool } from "./SubAgentTool";

export interface SubAgentSourceOptions {
  delegator: SubAgentDelegator;
  parent: SubAgentParentRun;
  evidence: EvidenceRegistry;
  available?: boolean;
}

/** Offers the session-backed delegation tools of one parent run and its evidence registry. */
export class SubAgentSource implements DataSource {
  readonly descriptor: DataSourceDescriptor;

  constructor(private readonly options: SubAgentSourceOptions) {
    this.descriptor = {
      id: "sub-agent",
      kind: "sub-agent",
      title: "Sub-agent",
      available: options.available ?? true,
    };
    options.parent.attachEvidence({
      remainingWebCapacity: () => options.evidence.remainingWebCapacity?.() ?? 0,
    });
  }

  tools(): Tool[] {
    const { delegator, parent, evidence } = this.options;
    return [
      new SubAgentTool({ delegator, parent }),
      new SubAgentResultTool({ delegator, parent, evidence }),
      new SubAgentWaitTool({ delegator }),
    ];
  }
}
