import { SourceReference } from "@core/model";
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
      // subarray — zero-copy view поверх общего буфера шарда.
      embedding: vectorData.subarray(start, end),
    };
  });
}

export function normalizeVector(vector: ArrayLike<number>): Float32Array {
  const normalized = new Float32Array(vector.length);
  let sumOfSquares = 0;

  for (let index = 0; index < vector.length; index += 1) {
    sumOfSquares += vector[index] * vector[index];
  }

  const magnitude = Math.sqrt(sumOfSquares);

  if (magnitude === 0) {
    return normalized;
  }

  for (let index = 0; index < vector.length; index += 1) {
    normalized[index] = vector[index] / magnitude;
  }

  return normalized;
}

export function dotProduct(left: ArrayLike<number>, right: ArrayLike<number>): number {
  let score = 0;
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
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
