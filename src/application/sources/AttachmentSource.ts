// Attachment data source (stage 1, task 5.3). Surfaces the note/attachment tools
// as a registered source. The tools are built by the composition root (which
// binds the concrete note service) and gated per-tool via permissions in the
// ToolManager, so this source is now just a thin descriptor + tool holder.

import { Tool } from "../../core/agent/tool";
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
