// Document-download data source. Contributes the read-only `probe_document_url`
// triage tool and the `download_document` mutation tool (gated by the download
// permission) to the agent loop. Mirrors WebSource: a thin DataSource wiring
// ports into `defineTool` definitions.

import { Tool } from "@core/agent";
import { SearchProvider } from "@application/ports";
import { VaultWriter } from "@application/ports";
import { DataSource, DataSourceDescriptor } from "@application/sources";
import { AUTO_CONFIRM_DOWNLOAD, DownloadConfirmation } from "./documentDownload";
import { DownloadDocumentTool, ProbeDocumentUrlTool } from "./DownloadTools";

export interface DownloadSourceOptions {
  provider: SearchProvider;
  writer: VaultWriter;
  defaultFolder: string;
  confirmation?: DownloadConfirmation;
  fetchImpl?: typeof fetch;
  available?: boolean;
}

export class DownloadSource implements DataSource {
  readonly descriptor: DataSourceDescriptor;
  private readonly provider: SearchProvider;
  private readonly writer: VaultWriter;
  private readonly defaultFolder: string;
  private readonly confirmation: DownloadConfirmation;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DownloadSourceOptions) {
    this.provider = options.provider;
    this.writer = options.writer;
    this.defaultFolder = options.defaultFolder;
    this.confirmation = options.confirmation ?? AUTO_CONFIRM_DOWNLOAD;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.descriptor = {
      id: "download",
      kind: "web",
      title: "Document download",
      available: options.available ?? true,
    };
  }

  tools(): Tool[] {
    return [
      new ProbeDocumentUrlTool({ fetchImpl: this.fetchImpl }),
      new DownloadDocumentTool({
        provider: this.provider,
        writer: this.writer,
        defaultFolder: this.defaultFolder,
        confirmation: this.confirmation,
      }),
    ];
  }
}
