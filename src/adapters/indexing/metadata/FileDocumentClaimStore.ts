import {
  DocumentClaim,
  DocumentClaimStore,
  FileSystemPort,
  SourceDocumentClaims,
} from "@application/ports";
import { joinVaultPath, sha256Hex } from "@shared";

interface ClaimsHeader {
  schemaVersion: 1;
  sourcePath: string;
  contentHash: string;
  generation: SourceDocumentClaims["generation"];
}

export class FileDocumentClaimStore implements DocumentClaimStore {
  constructor(
    private readonly fileSystem: FileSystemPort,
    private readonly folder: string,
  ) {}

  async read(sourcePath: string): Promise<SourceDocumentClaims | null> {
    try {
      const raw = await this.fileSystem.readText(this.fileFor(sourcePath));
      const parsed = parseClaimsFile(raw);
      return parsed && parsed.sourcePath === sourcePath ? parsed : null;
    } catch {
      return null;
    }
  }

  async write(claims: SourceDocumentClaims): Promise<void> {
    await this.fileSystem.createFolder(this.dir());
    await this.fileSystem.writeText(this.fileFor(claims.sourcePath), serializeClaimsFile(claims));
  }

  async list(): Promise<SourceDocumentClaims[]> {
    let files: string[];
    try {
      files = (await this.fileSystem.list(this.dir()))
        .filter((entry) => entry.kind === "file")
        .map((entry) => entry.name);
    } catch {
      return [];
    }

    const items: SourceDocumentClaims[] = [];
    for (const file of files) {
      if (!file.endsWith(".jsonl")) {
        continue;
      }
      try {
        const parsed = parseClaimsFile(
          await this.fileSystem.readText(joinVaultPath(this.dir(), file)),
        );
        if (parsed) {
          items.push(parsed);
        }
      } catch {
        continue;
      }
    }
    return items.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  }

  private dir(): string {
    return joinVaultPath(this.folder, "claims");
  }

  private fileFor(sourcePath: string): string {
    const id = sha256Hex(sourcePath).slice(0, 32);
    return joinVaultPath(this.dir(), `${id}.jsonl`);
  }
}

export function serializeClaimsFile(claims: SourceDocumentClaims): string {
  const header: ClaimsHeader = {
    schemaVersion: 1,
    sourcePath: claims.sourcePath,
    contentHash: claims.contentHash,
    generation: claims.generation,
  };
  return [header, ...claims.claims].map((line) => JSON.stringify(line)).join("\n");
}

export function parseClaimsFile(raw: string): SourceDocumentClaims | null {
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return null;
  }
  let header: unknown;
  try {
    header = JSON.parse(lines[0]);
  } catch {
    return null;
  }
  if (!isHeader(header)) {
    return null;
  }
  const claims: DocumentClaim[] = [];
  for (const line of lines.slice(1)) {
    try {
      const claim: unknown = JSON.parse(line);
      if (isClaim(claim)) {
        claims.push(claim);
      }
    } catch {
      continue;
    }
  }
  return {
    schemaVersion: 1,
    sourcePath: header.sourcePath,
    contentHash: header.contentHash,
    claims,
    generation: header.generation,
  };
}

function isHeader(value: unknown): value is ClaimsHeader {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === 1 &&
    typeof record.sourcePath === "string" &&
    typeof record.contentHash === "string" &&
    typeof record.generation === "object" &&
    record.generation !== null
  );
}

function isClaim(value: unknown): value is DocumentClaim {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.claimId === "string" &&
    typeof record.chunkId === "string" &&
    typeof record.sourcePath === "string" &&
    typeof record.subject === "string" &&
    typeof record.statement === "string" &&
    Array.isArray(record.topicKeys)
  );
}
