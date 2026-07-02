// Document-download tools. `probe_document_url` triages a link (is it a
// downloadable document?) without pulling the body; `download_document` fetches
// the bytes and, after user confirmation, stores them in the vault. Both are
// thin `defineTool` definitions over the shared helpers.

import { ToolPermissions, toolFailure } from "@core/agent";
import { DOWNLOAD_DOCUMENT_TOOL, PROBE_DOCUMENT_URL_TOOL } from "@core/agent";
import { SearchProvider } from "@application/ports";
import { VaultWriter } from "@application/ports";
import { validatePublicWebUrl } from "@application/sources";
import { bool, defineTool, str, strArray } from "@application/sources/tools";
import {
  DOWNLOAD_PERMISSIONS,
  DownloadConfirmation,
  MAX_DOCUMENT_BYTES,
  deriveFilename,
  folderOf,
  isDownloadableContentType,
  resolveDownloadPath,
  validateDownloadPath,
} from "./documentDownload";
import { DocumentProbeResult, probeDocumentUrls } from "./probeDocumentUrl";

export interface ProbeDocumentDeps {
  fetchImpl: typeof fetch;
}

export interface DownloadDocumentDeps {
  provider: SearchProvider;
  writer: VaultWriter;
  defaultFolder: string;
  confirmation: DownloadConfirmation;
}

interface ProbeInput {
  url?: string;
  urls?: string[];
}

interface ProbeOutput {
  results: DocumentProbeResult[];
}

interface DownloadInput {
  url: string;
  path?: string;
  overwrite?: boolean;
}

interface DownloadOutput {
  ok: true;
  path: string;
  bytes: number;
  contentType: string;
  finalUrl: string;
}

const MAX_URL_CHARS = 2_048;
const MAX_PATH_CHARS = 500;
const MAX_PROBE_URLS = 20;

export const ProbeDocumentUrlTool = defineTool<ProbeDocumentDeps, ProbeInput, ProbeOutput>({
  name: PROBE_DOCUMENT_URL_TOOL,
  description:
    "Check whether one or more public http(s) URLs point at a downloadable document (e.g. a PDF) before downloading. Reports content-type, size and a suggested filename for each URL without transferring the file body. Pass `url` for a single link or `urls` for a batch; results are returned as an array in input order.",
  schema: {
    url: str(MAX_URL_CHARS, { description: "Absolute http(s) URL to probe (single link)." }),
    urls: strArray(MAX_PROBE_URLS, MAX_URL_CHARS, {
      description: `Multiple absolute http(s) URLs to probe in one call (up to ${MAX_PROBE_URLS}).`,
    }),
  },
  execute: async (deps, input) => {
    const urls = collectProbeUrls(input);
    if (urls.length === 0) {
      return toolFailure("invalid-input", "Provide `url` or a non-empty `urls` array.");
    }
    const results = await probeDocumentUrls(deps.fetchImpl, urls);
    return { ok: true, value: { results } };
  },
});

/** Merge `url` + `urls` into a de-duplicated, order-preserving list, capped at MAX_PROBE_URLS. */
function collectProbeUrls(input: ProbeInput): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const candidate of [input.url, ...(input.urls ?? [])]) {
    const trimmed = candidate?.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      urls.push(trimmed);
    }
  }
  return urls.slice(0, MAX_PROBE_URLS);
}

export const DownloadDocumentTool = defineTool<
  DownloadDocumentDeps,
  DownloadInput,
  DownloadOutput
>({
  name: DOWNLOAD_DOCUMENT_TOOL,
  description:
    "Download a document (primarily PDF) from a public http(s) URL and save it into the vault. Requires user confirmation. Provide `path` (vault-relative, may end in '/' for a folder) to control the destination; otherwise the file lands in the default Ixplorer folder with a name derived from the URL.",
  schema: {
    url: str(MAX_URL_CHARS, { required: true, description: "Absolute http(s) URL of the document." }),
    path: str(MAX_PATH_CHARS, {
      description:
        "Optional vault-relative destination. A trailing '/' is treated as a folder and the filename is derived automatically.",
    }),
    overwrite: bool({ description: "If true, overwrite an existing file at the destination. Default false." }),
  },
  requires: (permissions: ToolPermissions) => permissions.has(DOWNLOAD_PERMISSIONS.write),
  execute: async (deps, input) => {
    const safeUrl = validatePublicWebUrl(input.url);
    if (!safeUrl.ok) {
      return toolFailure("unsafe-web-url", `The URL is not allowed (${safeUrl.reason}).`);
    }
    if (!deps.provider.fetchDocument) {
      return toolFailure("download-unsupported", "The web provider cannot download documents.");
    }

    const fetched = await deps.provider.fetchDocument(safeUrl.url, {
      maxResponseBytes: MAX_DOCUMENT_BYTES,
    });
    if (!fetched.ok) {
      return fetched;
    }
    if (!isDownloadableContentType(fetched.contentType)) {
      return toolFailure(
        "download-content-type",
        `The URL returned a non-document content type (${fetched.contentType}).`,
      );
    }

    const filename = deriveFilename(
      fetched.finalUrl,
      fetched.contentDisposition ?? null,
      fetched.contentType,
    );
    const path = resolveDownloadPath(input.path, deps.defaultFolder, filename);
    const validation = validateDownloadPath(path);
    if (!validation.ok) {
      return toolFailure(validation.reason, `The destination path is not allowed (${path}).`);
    }

    const exists = await deps.writer.exists(path);
    if (exists && input.overwrite !== true) {
      return toolFailure(
        "already-exists",
        `A file already exists at ${path}. Set overwrite:true to replace it or choose another path.`,
      );
    }

    const confirmed = await deps.confirmation.confirm({
      url: safeUrl.url,
      path,
      bytes: fetched.bytes,
      contentType: fetched.contentType,
    });
    if (!confirmed) {
      return toolFailure("user-cancelled", "The user declined the download.");
    }

    const folder = folderOf(path);
    if (folder) {
      await deps.writer.ensureFolder(folder);
    }
    await deps.writer.createBinaryFile(path, fetched.data);

    return {
      ok: true,
      value: {
        ok: true,
        path,
        bytes: fetched.bytes,
        contentType: fetched.contentType,
        finalUrl: fetched.finalUrl,
      },
    };
  },
});

