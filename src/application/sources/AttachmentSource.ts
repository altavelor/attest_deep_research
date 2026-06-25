// Attachment data source (stage 1, task 5.3). Wraps the note tool service
// (explicit notes / active file) and contributes its read/mutation tools.

import { Tool } from "../../core/agent/tool";
import { DataSource, DataSourceDescriptor } from "./DataSource";
import { NoteToolService } from "../../research/tools/NoteTools";
import {
  adaptNoteToolHandlers,
  NoteToolAvailability,
} from "../../research/tools/ResearchToolRegistry";

export interface AttachmentSourceOptions {
  service: NoteToolService;
  availability: NoteToolAvailability;
  available?: boolean;
}

export class AttachmentSource implements DataSource {
  readonly descriptor: DataSourceDescriptor;
  private readonly service: NoteToolService;
  private readonly availability: NoteToolAvailability;

  constructor(options: AttachmentSourceOptions) {
    this.service = options.service;
    this.availability = options.availability;
    this.descriptor = {
      id: "attachments",
      kind: "attachments",
      title: "Notes & attachments",
      available: options.available ?? true,
    };
  }

  tools(): Tool[] {
    return adaptNoteToolHandlers(this.service, this.availability);
  }
}
