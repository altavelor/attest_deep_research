// Fan-out data source (SPEC-corpus R5). Contributes the `map_sources` tool, which
// runs one document-scoped sub-agent per source and reduces to an evidence matrix.
// Gated separately from SubAgentSource: it needs both a sub-agent runner AND an
// index retriever (it fans out over indexed documents).

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
  /** The current turn's tool availability + collaborators, scoped per document per run. */
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
