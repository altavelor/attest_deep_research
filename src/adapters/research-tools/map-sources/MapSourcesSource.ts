import { Tool } from "@core/agent";
import { DataSource, DataSourceDescriptor } from "@application/sources";
import { EvidenceRegistry } from "@application/sources";
import { ResearchRetriever } from "@application/contracts/research";
import { ResearchToolsetOptions, SubAgentPort } from "@application/research";
import { MapSources } from "@application/use-cases/map-sources";
import { MapSourcesTool } from "./MapSourcesTool";

export interface MapSourcesSourceOptions {
  runner: SubAgentPort;
  retriever: ResearchRetriever;
  evidence: EvidenceRegistry;
  toolContext: ResearchToolsetOptions;
  available?: boolean;
}

export class MapSourcesSource implements DataSource {
  readonly descriptor: DataSourceDescriptor;
  private readonly mapper: MapSources;
  private readonly evidence: EvidenceRegistry;

  constructor(options: MapSourcesSourceOptions) {
    this.evidence = options.evidence;
    this.mapper = new MapSources({
      runner: options.runner,
      retriever: options.retriever,
      toolContext: options.toolContext,
    });
    this.descriptor = {
      id: "map-sources",
      kind: "sub-agent",
      title: "Fan-out",
      available: options.available ?? true,
    };
  }

  tools(): Tool[] {
    return [new MapSourcesTool({ mapper: this.mapper, evidence: this.evidence })];
  }
}
