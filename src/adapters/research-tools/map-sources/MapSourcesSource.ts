import { Tool } from "@core/agent";
import { DataSource, DataSourceDescriptor } from "@application/sources";
import { EvidenceRegistry } from "@application/sources";
import { ResearchRetriever } from "@application/contracts/research";
import type { MapSourcesRunContext } from "@application/ports/mapSources";
import type { SubAgentParentRun } from "@application/ports/subAgent";
import { MapSources } from "@application/use-cases/map-sources";
import { MapSourcesResultTool, MapSourcesTool } from "./MapSourcesTool";

export interface MapSourcesSourceOptions {
  context: MapSourcesRunContext;
  parent: SubAgentParentRun;
  retriever: ResearchRetriever;
  evidence: EvidenceRegistry;
  available?: boolean;
}

/** Offers the fan-out tools of one parent run over its session-backed document workers. */
export class MapSourcesSource implements DataSource {
  readonly descriptor: DataSourceDescriptor;
  private readonly mapper: MapSources;

  constructor(private readonly options: MapSourcesSourceOptions) {
    const { context, parent } = options;
    this.mapper = new MapSources({
      runner: context.workers,
      retriever: options.retriever,
      context,
      resolver: parent.resolver,
      evidence: options.evidence,
    });
    this.descriptor = {
      id: "map-sources",
      kind: "sub-agent",
      title: "Fan-out",
      available: options.available ?? true,
    };
  }

  tools(): Tool[] {
    const deps = { mapper: this.mapper, parentRunId: this.options.parent.parentRunId };
    return [new MapSourcesTool(deps), new MapSourcesResultTool(deps)];
  }
}
