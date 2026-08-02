import { Tool } from "@core/agent";
import { ToolManager } from "@application/tools/ToolManager";

export type SourceKind = "rag" | "web" | "attachments" | "sub-agent" | "media";

export interface DataSourceDescriptor {
  id: string;
  kind: SourceKind;
  title: string;
  available: boolean;
  unavailableReason?: string;
}

export interface DataSource {
  readonly descriptor: DataSourceDescriptor;

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
