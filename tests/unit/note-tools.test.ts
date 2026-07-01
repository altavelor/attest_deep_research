import { MarkdownExtractor } from "@adapters/extractors";
import { ContextFileProvider, VaultWriter } from "@application/ports";
import { AUTO_CONFIRM, NoteActionConfirmation, NoteToolService, validateMutablePath } from "@adapters/research-tools";

class MemoryContextFiles implements ContextFileProvider {
  constructor(private readonly files: Record<string, string>) { }

  async listPaths(): Promise<string[]> {
    return Object.keys(this.files).sort();
  }

  async readFile(path: string): Promise<string> {
    return this.files[path] ?? "";
  }

  async getModifiedTime(): Promise<number> {
    return 0;
  }

  async getSize(path: string): Promise<number> {
    return this.files[path]?.length ?? 0;
  }
}

describe("NoteToolService", () => {
  it("reads notes through the context extractor pipeline with truncation metadata", async () => {
    const service = new NoteToolService({
      files: new MemoryContextFiles({
        "Research/Long.md": `# Long\n\n${"Important context. ".repeat(50)}`,
      }),
      extractors: [new MarkdownExtractor({ maxChunkLength: 200, chunkOverlap: 0 })],
      readNoteMaxChars: 180,
    });

    const result = await service.execute({
      id: "call-1",
      name: "read_note",
      arguments: { path: "Research/Long.md" },
    });
    const parsed = JSON.parse(result.result) as {
      ok: boolean;
      path: string;
      content: string;
      truncated: boolean;
      chunks: unknown[];
    };

    expect(result.ok).toBe(true);
    expect(parsed).toMatchObject({
      ok: true,
      path: "Research/Long.md",
      truncated: true,
    });
    expect(parsed.content.length).toBeLessThanOrEqual(180);
    expect(parsed.chunks.length).toBeGreaterThan(0);
  });

  it("searches notes by path keyword and returns editingOnly marker", async () => {
    const service = new NoteToolService({
      files: new MemoryContextFiles({
        "Research/Match.md": "body",
        "Daily.md": "body",
      }),
      extractors: [new MarkdownExtractor()],
    });

    const result = await service.execute({
      id: "call-1",
      name: "search_notes",
      arguments: { query: "daily" },
    });
    const parsed = JSON.parse(result.result) as {
      source: string;
      editingOnly: boolean;
      results: Array<{ path: string }>;
    };

    expect(parsed.source).toBe("path");
    expect(parsed.editingOnly).toBe(true);
    expect(parsed.results).toEqual([{ path: "Daily.md", snippet: "Daily.md" }]);
  });

  it("lists supported paths with prefix, query, and limit", async () => {
    const service = new NoteToolService({
      files: new MemoryContextFiles({
        "Projects/A.md": "a",
        "Projects/B.md": "b",
        "Archive/C.md": "c",
      }),
      extractors: [new MarkdownExtractor()],
    });

    const result = await service.execute({
      id: "call-1",
      name: "list_notes",
      arguments: { prefix: "Projects", query: ".md", limit: 1 },
    });
    const parsed = JSON.parse(result.result) as {
      paths: string[];
      totalCount: number;
      hasMore: boolean;
    };

    expect(parsed).toEqual({
      ok: true,
      paths: ["Projects/A.md"],
      count: 1,
      totalCount: 2,
      hasMore: true,
      limit: 1,
    });
  });
});

describe("validateMutablePath", () => {
  it("accepts a valid markdown path", () => {
    expect(validateMutablePath("Notes/Hello.md")).toEqual({ ok: true });
  });

  it("accepts a nested markdown path", () => {
    expect(validateMutablePath("folder/sub/note.md")).toEqual({ ok: true });
  });

  it("rejects a non-.md path", () => {
    expect(validateMutablePath("Notes/image.png")).toEqual({
      ok: false,
      reason: "invalid-path",
    });
  });

  it("rejects an empty path", () => {
    expect(validateMutablePath("")).toEqual({ ok: false, reason: "invalid-path" });
  });

  it("rejects .ixplorer/ paths", () => {
    expect(validateMutablePath(".ixplorer/skills/foo.md")).toEqual({
      ok: false,
      reason: "forbidden-path",
    });
  });

  it("rejects path traversal with ..", () => {
    expect(validateMutablePath("../../secret.md")).toEqual({
      ok: false,
      reason: "invalid-path",
    });
  });

  it("rejects path with . segment", () => {
    expect(validateMutablePath("./Notes/foo.md")).toEqual({
      ok: false,
      reason: "invalid-path",
    });
  });

  it("rejects nested path traversal", () => {
    expect(validateMutablePath("Notes/../../../etc/passwd.md")).toEqual({
      ok: false,
      reason: "invalid-path",
    });
  });
});

describe("AUTO_CONFIRM", () => {
  it("always resolves to true", async () => {
    const result = await AUTO_CONFIRM.confirm({ action: "create", path: "Notes/a.md" });
    expect(result).toBe(true);
  });
});

describe("VaultWriter type contract", () => {
  it("MemoryVaultWriter satisfies VaultWriter interface at compile time", () => {
    const writer: VaultWriter = new MemoryVaultWriter();
    expect(writer).toBeDefined();
  });
});

class MemoryVaultWriter implements VaultWriter {
  readonly files = new Map<string, string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async createFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async modifyFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async appendFile(path: string, content: string): Promise<void> {
    this.files.set(path, (this.files.get(path) ?? "") + content);
  }

  async readFile(path: string): Promise<string> {
    return this.files.get(path) ?? "";
  }

  async trashFile(path: string): Promise<void> {
    this.files.delete(path);
  }

  async ensureFolder(_path: string): Promise<void> { }
}

function makeWriter(initial: Record<string, string> = {}): MemoryVaultWriter {
  const w = new MemoryVaultWriter();
  for (const [k, v] of Object.entries(initial)) w.files.set(k, v);
  return w;
}

function denyConfirm(): NoteActionConfirmation {
  return { confirm: async () => false };
}

describe("create_note tool", () => {
  function makeService(
    writer: MemoryVaultWriter,
    confirmation?: NoteActionConfirmation,
  ): NoteToolService {
    return new NoteToolService({
      files: new MemoryContextFiles({}),
      extractors: [],
      writer,
      confirmation,
      noteMutationAccess: true,
    });
  }

  it("creates a new note", async () => {
    const writer = makeWriter();
    const svc = makeService(writer);
    const result = await svc.execute({
      id: "c1",
      name: "create_note",
      arguments: { path: "Notes/Hello.md", content: "# Hello" },
    });
    const parsed = JSON.parse(result.result);
    expect(result.ok).toBe(true);
    expect(parsed.created).toBe(true);
    expect(parsed.path).toBe("Notes/Hello.md");
    expect(writer.files.get("Notes/Hello.md")).toBe("# Hello");
  });

  it("rewrites evidence-ID citation tokens into footnote links when creating a note", async () => {
    const writer = makeWriter();
    const svc = makeService(writer);
    svc.setCitationProvider(() => [
      {
        id: "web:abc",
        label: "Elephant — Wikipedia",
        source: {
          id: "web:abc",
          kind: "web",
          title: "Elephant — Wikipedia",
          url: "https://en.wikipedia.org/wiki/Elephant",
          snippet: "",
          retrievedAt: "2026-06-25T00:00:00.000Z",
          wasContentFetched: false,
        },
      },
    ]);

    const result = await svc.execute({
      id: "c-cite",
      name: "create_note",
      arguments: { path: "Notes/Elephant.md", content: "Elephants live up to 70 years [web:abc]." },
    });

    expect(result.ok).toBe(true);
    const written = writer.files.get("Notes/Elephant.md") ?? "";
    expect(written).toContain("Elephants live up to 70 years [^1].");
    expect(written).toContain("[^1]: [Elephant — Wikipedia](https://en.wikipedia.org/wiki/Elephant)");
    expect(written).not.toContain("web:abc.");
  });

  it("returns already-exists when file exists and overwrite is false", async () => {
    const writer = makeWriter({ "Notes/Exists.md": "old" });
    const svc = makeService(writer);
    const result = await svc.execute({
      id: "c2",
      name: "create_note",
      arguments: { path: "Notes/Exists.md", content: "new" },
    });
    const parsed = JSON.parse(result.result);
    expect(result.ok).toBe(false);
    expect(parsed.reason).toBe("already-exists");
    expect(parsed.hint).toBeTruthy();
    expect(writer.files.get("Notes/Exists.md")).toBe("old");
  });

  it("checks existence before asking confirmation — confirmation not called on already-exists", async () => {
    const writer = makeWriter({ "Notes/Exists.md": "old" });
    let confirmCalled = false;
    const confirmation: NoteActionConfirmation = {
      confirm: async () => {
        confirmCalled = true;
        return true;
      },
    };
    const svc = makeService(writer, confirmation);
    const result = await svc.execute({
      id: "c-order",
      name: "create_note",
      arguments: { path: "Notes/Exists.md", content: "new" },
    });
    expect(JSON.parse(result.result).reason).toBe("already-exists");
    expect(confirmCalled).toBe(false);
  });

  it("overwrites when overwrite is true", async () => {
    const writer = makeWriter({ "Notes/Exists.md": "old" });
    const svc = makeService(writer);
    const result = await svc.execute({
      id: "c3",
      name: "create_note",
      arguments: { path: "Notes/Exists.md", content: "new", overwrite: true },
    });
    expect(result.ok).toBe(true);
    expect(writer.files.get("Notes/Exists.md")).toBe("new");
  });

  it("returns forbidden-path for .ixplorer/ path", async () => {
    const writer = makeWriter();
    const svc = makeService(writer);
    const result = await svc.execute({
      id: "c4",
      name: "create_note",
      arguments: { path: ".ixplorer/skills/foo.md", content: "x" },
    });
    expect(JSON.parse(result.result).reason).toBe("forbidden-path");
  });

  it("returns invalid-path for non-.md path", async () => {
    const writer = makeWriter();
    const svc = makeService(writer);
    const result = await svc.execute({
      id: "c5",
      name: "create_note",
      arguments: { path: "Notes/image.png", content: "x" },
    });
    expect(JSON.parse(result.result).reason).toBe("invalid-path");
  });

  it("returns user-cancelled when confirmation returns false", async () => {
    const writer = makeWriter();
    const svc = makeService(writer, denyConfirm());
    const result = await svc.execute({
      id: "c6",
      name: "create_note",
      arguments: { path: "Notes/Hello.md", content: "x" },
    });
    expect(JSON.parse(result.result).reason).toBe("user-cancelled");
    expect(writer.files.has("Notes/Hello.md")).toBe(false);
  });

  it("is not available when writer is absent", () => {
    const svc = new NoteToolService({
      files: new MemoryContextFiles({}),
      extractors: [],
      noteMutationAccess: true,
    });
    expect(svc.supports("create_note")).toBe(false);
  });
});

describe("update_note tool", () => {
  function makeService(
    writer: MemoryVaultWriter,
    confirmation?: NoteActionConfirmation,
  ): NoteToolService {
    return new NoteToolService({
      files: new MemoryContextFiles({}),
      extractors: [],
      writer,
      confirmation,
      noteMutationAccess: true,
    });
  }

  it("replaces content by default", async () => {
    const writer = makeWriter({ "Notes/A.md": "old" });
    const svc = makeService(writer);
    const result = await svc.execute({
      id: "u1",
      name: "update_note",
      arguments: { path: "Notes/A.md", content: "new" },
    });
    const parsed = JSON.parse(result.result);
    expect(result.ok).toBe(true);
    expect(parsed.mode).toBe("replace");
    expect(writer.files.get("Notes/A.md")).toBe("new");
  });

  it("appends content", async () => {
    const writer = makeWriter({ "Notes/A.md": "hello" });
    const svc = makeService(writer);
    await svc.execute({
      id: "u2",
      name: "update_note",
      arguments: { path: "Notes/A.md", content: " world", mode: "append" },
    });
    expect(writer.files.get("Notes/A.md")).toBe("hello world");
  });

  it("prepends content", async () => {
    const writer = makeWriter({ "Notes/A.md": "existing" });
    const svc = makeService(writer);
    const result = await svc.execute({
      id: "u3",
      name: "update_note",
      arguments: { path: "Notes/A.md", content: "header", mode: "prepend" },
    });
    expect(result.ok).toBe(true);
    expect(writer.files.get("Notes/A.md")).toBe("header\n\nexisting");
  });

  it("returns not-found with hint when file does not exist", async () => {
    const writer = makeWriter();
    const svc = makeService(writer);
    const result = await svc.execute({
      id: "u4",
      name: "update_note",
      arguments: { path: "Notes/Missing.md", content: "x" },
    });
    const parsed = JSON.parse(result.result);
    expect(parsed.reason).toBe("not-found");
    expect(parsed.hint).toBeTruthy();
  });

  it("returns user-cancelled when confirmation returns false", async () => {
    const writer = makeWriter({ "Notes/A.md": "old" });
    const svc = makeService(writer, denyConfirm());
    const result = await svc.execute({
      id: "u5",
      name: "update_note",
      arguments: { path: "Notes/A.md", content: "new" },
    });
    expect(JSON.parse(result.result).reason).toBe("user-cancelled");
    expect(writer.files.get("Notes/A.md")).toBe("old");
  });
});

describe("delete_note tool", () => {
  function makeService(
    writer: MemoryVaultWriter,
    confirmation?: NoteActionConfirmation,
  ): NoteToolService {
    return new NoteToolService({
      files: new MemoryContextFiles({}),
      extractors: [],
      writer,
      confirmation,
      noteMutationAccess: true,
    });
  }

  it("trashes an existing note", async () => {
    const writer = makeWriter({ "Notes/Old.md": "bye" });
    const svc = makeService(writer);
    const result = await svc.execute({
      id: "d1",
      name: "delete_note",
      arguments: { path: "Notes/Old.md" },
    });
    const parsed = JSON.parse(result.result);
    expect(result.ok).toBe(true);
    expect(parsed.trashed).toBe(true);
    expect(writer.files.has("Notes/Old.md")).toBe(false);
  });

  it("returns not-found when file does not exist", async () => {
    const writer = makeWriter();
    const svc = makeService(writer);
    const result = await svc.execute({
      id: "d2",
      name: "delete_note",
      arguments: { path: "Notes/Missing.md" },
    });
    expect(JSON.parse(result.result).reason).toBe("not-found");
  });

  it("returns forbidden-path for .ixplorer/ path", async () => {
    const writer = makeWriter({ ".ixplorer/foo.md": "x" });
    const svc = makeService(writer);
    const result = await svc.execute({
      id: "d3",
      name: "delete_note",
      arguments: { path: ".ixplorer/foo.md" },
    });
    expect(JSON.parse(result.result).reason).toBe("forbidden-path");
  });

  it("returns user-cancelled when confirmation returns false", async () => {
    const writer = makeWriter({ "Notes/Old.md": "bye" });
    const svc = makeService(writer, denyConfirm());
    const result = await svc.execute({
      id: "d4",
      name: "delete_note",
      arguments: { path: "Notes/Old.md" },
    });
    expect(JSON.parse(result.result).reason).toBe("user-cancelled");
    expect(writer.files.has("Notes/Old.md")).toBe(true);
  });
});
