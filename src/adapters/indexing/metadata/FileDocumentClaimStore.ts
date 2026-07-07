// Sidecar storage for the claim index (SPEC-corpus R7): one JSONL file per source
// under `<index folder>/claims/`, named by a stable hash of the source path. The
// first line is a header (schema/provenance + contentHash for incremental re-runs);
// each following line is one claim, so the file streams and stays diff-friendly.

import { createHash } from "crypto";
import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

import { DocumentClaim, DocumentClaimStore, SourceDocumentClaims } from "@application/ports";

interface ClaimsHeader {
  schemaVersion: 1;
  sourcePath: string;
  contentHash: string;
  generation: SourceDocumentClaims["generation"];
}

export class FileDocumentClaimStore implements DocumentClaimStore {
  constructor(private readonly folder: string) {}

  async read(sourcePath: string): Promise<SourceDocumentClaims | null> {
    try {
      const raw = await readFile(this.fileFor(sourcePath), "utf8");
      const parsed = parseClaimsFile(raw);
      return parsed && parsed.sourcePath === sourcePath ? parsed : null;
    } catch {
      return null;
    }
  }

  async write(claims: SourceDocumentClaims): Promise<void> {
    await mkdir(this.dir(), { recursive: true });
    await writeFile(this.fileFor(claims.sourcePath), serializeClaimsFile(claims), "utf8");
  }

  async list(): Promise<SourceDocumentClaims[]> {
    let files: string[];
    try {
      files = await readdir(this.dir());
    } catch {
      return [];
    }

    const items: SourceDocumentClaims[] = [];
    for (const file of files) {
      if (!file.endsWith(".jsonl")) {
        continue;
      }
      try {
        const parsed = parseClaimsFile(await readFile(join(this.dir(), file), "utf8"));
        if (parsed) {
          items.push(parsed);
        }
      } catch {
        // A corrupt sidecar does not break the inventory — the source re-enriches.
      }
    }
    return items.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  }

  private dir(): string {
    return join(this.folder, "claims");
  }

  private fileFor(sourcePath: string): string {
    const id = createHash("sha256").update(sourcePath).digest("hex").slice(0, 32);
    return join(this.dir(), `${id}.jsonl`);
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
      const claim = JSON.parse(line);
      if (isClaim(claim)) {
        claims.push(claim);
      }
    } catch {
      // Skip a malformed claim line; the rest of the file still loads.
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
