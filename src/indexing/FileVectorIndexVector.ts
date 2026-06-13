import { SourceReference } from "../shared/types";
import {
  FileVectorChunkRow,
  FileVectorManifest,
  VECTOR_FLOAT_BYTES,
} from "./FileVectorIndexFormat";
import { throwRebuildRequired } from "./FileVectorIndexErrors";
import type { StoredChunk } from "./FileVectorIndexState";

export function encodeStoredChunks(chunks: StoredChunk[], dimensions: number): Uint8Array {
  const vectorData = new Float32Array(chunks.length * dimensions);

  chunks.forEach((chunk, chunkIndex) => {
    chunk.row.vectorOffset = chunkIndex * dimensions * VECTOR_FLOAT_BYTES;
    chunk.row.vectorLength = dimensions;
    vectorData.set(chunk.embedding, chunkIndex * dimensions);
  });

  return new Uint8Array(vectorData.buffer);
}

export function decodeStoredChunks(
  rows: FileVectorChunkRow[],
  vectorBytes: Uint8Array,
  manifest: FileVectorManifest,
): StoredChunk[] {
  const vectorData = new Float32Array(
    vectorBytes.buffer,
    vectorBytes.byteOffset,
    Math.floor(vectorBytes.byteLength / VECTOR_FLOAT_BYTES),
  );

  return rows.map((row) => {
    const start = row.vectorOffset / VECTOR_FLOAT_BYTES;
    const end = start + row.vectorLength;

    if (
      row.vectorLength !== manifest.embeddingDimensions ||
      !Number.isInteger(start) ||
      end > vectorData.length
    ) {
      throwRebuildRequired({
        reason: "chunk-vector-range-invalid",
        chunkId: row.id,
        vectorOffset: row.vectorOffset,
        vectorLength: row.vectorLength,
      });
    }

    return {
      row,
      embedding: Array.from(vectorData.slice(start, end)),
    };
  });
}

export function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));

  if (magnitude === 0) {
    return vector.map(() => 0);
  }

  return vector.map((value) => value / magnitude);
}

export function dotProduct(left: number[], right: number[]): number {
  let score = 0;

  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    score += left[index] * right[index];
  }

  return score;
}

export function sourcePathFromReference(source: SourceReference): string {
  if (source.kind === "web") {
    return source.url;
  }

  return source.path;
}
