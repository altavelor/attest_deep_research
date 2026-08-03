import { Tool } from "@core/agent";
import { DataSource, DataSourceDescriptor } from "./DataSource";

export interface AttachmentSourceOptions {
  tools: Tool[];
  available?: boolean;
}

export class AttachmentSource implements DataSource {
  readonly descriptor: DataSourceDescriptor;
  private readonly toolList: Tool[];

  constructor(options: AttachmentSourceOptions) {
    this.toolList = options.tools;
    this.descriptor = {
      id: "attachments",
      kind: "attachments",
      title: "Notes & attachments",
      available: options.available ?? true,
    };
  }

  tools(): Tool[] {
    return this.toolList;
  }
}
