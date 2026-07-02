import { describe, expect, it, vi } from "vitest";
import { executeTool } from "@core/agent";
import { SearchProvider, VaultWriter } from "@application/ports";
import {
  DownloadDocumentTool,
  ProbeDocumentUrlTool,
} from "@adapters/research-tools/download/DownloadTools";
import {
  deriveFilename,
  resolveDownloadPath,
  validateDownloadPath,
} from "@adapters/research-tools/download/documentDownload";

class MemoryWriter implements VaultWriter {
  readonly binary = new Map<string, Uint8Array>();
  readonly folders = new Set<string>();
  existing = new Set<string>();

  async exists(path: string): Promise<boolean> {
    return this.existing.has(path) || this.binary.has(path);
  }
  async createFile(): Promise<void> {}
  async createBinaryFile(path: string, data: Uint8Array): Promise<void> {
    this.binary.set(path, data);
  }
  async modifyFile(): Promise<void> {}
  async appendFile(): Promise<void> {}
  async readFile(): Promise<string> {
    return "";
  }
  async trashFile(): Promise<void> {}
  async ensureFolder(path: string): Promise<void> {
    this.folders.add(path);
  }
}

function pdfDocument(overrides: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    url: "https://example.com/paper.pdf",
    finalUrl: "https://example.com/paper.pdf",
    data: new Uint8Array([1, 2, 3, 4]),
    contentType: "application/pdf",
    bytes: 4,
    redirects: [],
    ...overrides,
  };
}

function makeDownloadTool(
  provider: Partial<SearchProvider>,
  writer: VaultWriter,
  extra: { defaultFolder?: string; confirm?: () => Promise<boolean> } = {},
) {
  return new DownloadDocumentTool({
    provider: { search: vi.fn(), ...provider } as SearchProvider,
    writer,
    defaultFolder: extra.defaultFolder ?? "Ixplorer/Downloads",
    confirmation: { confirm: extra.confirm ?? (async () => true) },
  });
}

function call(args: Record<string, unknown>) {
  return { id: "c1", name: "download_document", arguments: args };
}

describe("DownloadDocumentTool", () => {
  it("downloads a PDF into the default folder and writes the bytes", async () => {
    const fetchDocument = vi.fn().mockResolvedValue(pdfDocument());
    const writer = new MemoryWriter();
    const tool = makeDownloadTool({ fetchDocument }, writer);

    const execution = await executeTool(tool, call({ url: "https://example.com/paper.pdf" }));

    expect(execution).toMatchObject({
      ok: true,
      value: { path: "Ixplorer/Downloads/paper.pdf", bytes: 4, contentType: "application/pdf" },
    });
    expect(writer.binary.get("Ixplorer/Downloads/paper.pdf")).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(writer.folders.has("Ixplorer/Downloads")).toBe(true);
  });

  it("prefers the Content-Disposition filename over an opaque URL segment", async () => {
    const fetchDocument = vi.fn().mockResolvedValue(
      pdfDocument({
        url: "https://example.com/download?id=42",
        finalUrl: "https://example.com/download?id=42",
        contentDisposition: 'attachment; filename="Annual Report.pdf"',
      }),
    );
    const writer = new MemoryWriter();
    const tool = makeDownloadTool({ fetchDocument }, writer);

    const execution = await executeTool(tool, call({ url: "https://example.com/download?id=42" }));

    expect(execution).toMatchObject({
      ok: true,
      value: { path: "Ixplorer/Downloads/Annual Report.pdf" },
    });
  });

  it("treats a trailing-slash path as a folder and derives the filename", async () => {
    const fetchDocument = vi.fn().mockResolvedValue(pdfDocument());
    const writer = new MemoryWriter();
    const tool = makeDownloadTool({ fetchDocument }, writer);

    const execution = await executeTool(
      tool,
      call({ url: "https://example.com/paper.pdf", path: "Refs/" }),
    );

    expect(execution).toMatchObject({ ok: true, value: { path: "Refs/paper.pdf" } });
  });

  it("rejects non-public URLs before any fetch", async () => {
    const fetchDocument = vi.fn();
    const tool = makeDownloadTool({ fetchDocument }, new MemoryWriter());

    const execution = await executeTool(tool, call({ url: "http://localhost/secret.pdf" }));

    expect(execution).toMatchObject({ ok: false, error: { code: "unsafe-web-url" } });
    expect(fetchDocument).not.toHaveBeenCalled();
  });

  it("fails when the provider cannot download documents", async () => {
    const tool = makeDownloadTool({}, new MemoryWriter());
    const execution = await executeTool(tool, call({ url: "https://example.com/paper.pdf" }));
    expect(execution).toMatchObject({ ok: false, error: { code: "download-unsupported" } });
  });

  it("rejects a non-document content type", async () => {
    const fetchDocument = vi
      .fn()
      .mockResolvedValue(pdfDocument({ contentType: "text/html" }));
    const tool = makeDownloadTool({ fetchDocument }, new MemoryWriter());

    const execution = await executeTool(tool, call({ url: "https://example.com/paper.pdf" }));
    expect(execution).toMatchObject({ ok: false, error: { code: "download-content-type" } });
  });

  it("refuses to overwrite an existing file unless overwrite is set", async () => {
    const fetchDocument = vi.fn().mockResolvedValue(pdfDocument());
    const writer = new MemoryWriter();
    writer.existing.add("Ixplorer/Downloads/paper.pdf");
    const tool = makeDownloadTool({ fetchDocument }, writer);

    const blocked = await executeTool(tool, call({ url: "https://example.com/paper.pdf" }));
    expect(blocked).toMatchObject({ ok: false, error: { code: "already-exists" } });

    const forced = await executeTool(
      tool,
      call({ url: "https://example.com/paper.pdf", overwrite: true }),
    );
    expect(forced).toMatchObject({ ok: true });
  });

  it("does not write when the user declines", async () => {
    const fetchDocument = vi.fn().mockResolvedValue(pdfDocument());
    const writer = new MemoryWriter();
    const tool = makeDownloadTool({ fetchDocument }, writer, { confirm: async () => false });

    const execution = await executeTool(tool, call({ url: "https://example.com/paper.pdf" }));
    expect(execution).toMatchObject({ ok: false, error: { code: "user-cancelled" } });
    expect(writer.binary.size).toBe(0);
  });

  it("propagates a provider fetch failure", async () => {
    const fetchDocument = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { code: "web-fetch-http", message: "boom" } });
    const tool = makeDownloadTool({ fetchDocument }, new MemoryWriter());

    const execution = await executeTool(tool, call({ url: "https://example.com/paper.pdf" }));
    expect(execution).toMatchObject({ ok: false, error: { code: "web-fetch-http" } });
  });
});

describe("ProbeDocumentUrlTool", () => {
  function fakeFetch(headers: Record<string, string>, init: { status?: number; url?: string } = {}) {
    return vi.fn().mockResolvedValue({
      ok: (init.status ?? 200) < 400,
      status: init.status ?? 200,
      url: init.url ?? "https://example.com/paper.pdf",
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      body: null,
    });
  }

  it("reports a PDF URL as downloadable", async () => {
    const fetchImpl = fakeFetch({
      "content-type": "application/pdf",
      "content-length": "2048",
    });
    const tool = new ProbeDocumentUrlTool({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const execution = await executeTool(tool, {
      id: "c",
      name: "probe_document_url",
      arguments: { url: "https://example.com/paper.pdf" },
    });

    expect(execution).toMatchObject({
      ok: true,
      value: {
        results: [
          {
            downloadable: true,
            contentType: "application/pdf",
            sizeBytes: 2048,
            suggestedFilename: "paper.pdf",
          },
        ],
      },
    });
  });

  it("marks non-public URLs as not downloadable", async () => {
    const fetchImpl = fakeFetch({});
    const tool = new ProbeDocumentUrlTool({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const execution = await executeTool(tool, {
      id: "c",
      name: "probe_document_url",
      arguments: { url: "http://127.0.0.1/paper.pdf" },
    });

    expect(execution).toMatchObject({
      ok: true,
      value: { results: [{ downloadable: false }] },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("probes a batch of URLs in input order and de-duplicates", async () => {
    const fetchImpl = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      url,
      headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/pdf" : null) },
      body: null,
    }));
    const tool = new ProbeDocumentUrlTool({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const execution = await executeTool(tool, {
      id: "c",
      name: "probe_document_url",
      arguments: {
        url: "https://example.com/a.pdf",
        urls: ["https://example.com/b.pdf", "https://example.com/a.pdf"],
      },
    });

    expect(execution).toMatchObject({
      ok: true,
      value: {
        results: [
          { url: "https://example.com/a.pdf", suggestedFilename: "a.pdf" },
          { url: "https://example.com/b.pdf", suggestedFilename: "b.pdf" },
        ],
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails when neither url nor urls is provided", async () => {
    const fetchImpl = vi.fn();
    const tool = new ProbeDocumentUrlTool({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const execution = await executeTool(tool, {
      id: "c",
      name: "probe_document_url",
      arguments: {},
    });

    expect(execution).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("documentDownload helpers", () => {
  it("derives a filename from Content-Disposition, URL, then content-type", () => {
    expect(
      deriveFilename("https://x.com/a", 'attachment; filename="report.pdf"', "application/pdf"),
    ).toBe("report.pdf");
    expect(deriveFilename("https://x.com/docs/guide.pdf", null, "application/pdf")).toBe("guide.pdf");
    expect(deriveFilename("https://x.com/download", null, "application/pdf")).toBe("download.pdf");
  });

  it("appends an extension when the URL's trailing token is not a real one (e.g. arXiv ids)", () => {
    expect(deriveFilename("https://arxiv.org/pdf/2301.12345", null, "application/pdf")).toBe(
      "2301.12345.pdf",
    );
  });

  it("resolves destinations from explicit path, folder, or default", () => {
    expect(resolveDownloadPath("Refs/x.pdf", "Def", "d.pdf")).toBe("Refs/x.pdf");
    expect(resolveDownloadPath("Refs/", "Def", "d.pdf")).toBe("Refs/d.pdf");
    expect(resolveDownloadPath(undefined, "Def", "d.pdf")).toBe("Def/d.pdf");
  });

  it("rejects traversal and reserved paths", () => {
    expect(validateDownloadPath("../escape.pdf").ok).toBe(false);
    expect(validateDownloadPath(".ixplorer/x.pdf").ok).toBe(false);
    expect(validateDownloadPath("Refs/ok.pdf").ok).toBe(true);
  });
});
