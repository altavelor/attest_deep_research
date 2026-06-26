// External data sources (stage 1, task 5.x / R5).
//
// A DataSource is a pluggable provider of context (RAG, web, attachments). Two
// distinct contracts compose here:
//   - Tool (core/agent): the runtime path the model invokes during a round.
//   - DataSource/SourceManager (this module): the registration + introspection
//     path the application/UI uses to know which sources are available.
// Each source contributes its tools into a ToolManager; the SourceManager also
// exposes descriptors so callers can present "available sources" without going
// through the agent loop.

import { Tool, ToolManager } from "../../core/agent/tool";

export type SourceKind = "rag" | "web" | "attachments" | "deep-research";

export interface DataSourceDescriptor {
  id: string;
  kind: SourceKind;
  title: string;
  available: boolean;
  unavailableReason?: string;
}

export interface DataSource {
  readonly descriptor: DataSourceDescriptor;
  /** The tools this source contributes to the agent loop. */
  tools(): Tool[];
}

export class SourceManager {
  private readonly sources: DataSource[] = [];

  register(source: DataSource): void {
    this.sources.push(source);
  }

  descriptors(): DataSourceDescriptor[] {
    return this.sources.map((source) => source.descriptor);
  }

  get(id: string): DataSource | undefined {
    return this.sources.find((source) => source.descriptor.id === id);
  }

  byKind(kind: SourceKind): DataSource[] {
    return this.sources.filter((source) => source.descriptor.kind === kind);
  }

  /** All tools from available sources, in registration order. */
  tools(): Tool[] {
    return this.sources
      .filter((source) => source.descriptor.available)
      .flatMap((source) => source.tools());
  }

  /** Bridge R5 -> R3: register every available source's tools into the loop's manager. */
  contributeTools(manager: ToolManager): void {
    for (const tool of this.tools()) {
      manager.register(tool);
    }
  }
}
