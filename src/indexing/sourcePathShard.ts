export function shardIdForSourcePath(sourcePath: string, shardCount = 32): string {
  const normalizedPath = sourcePath.trim().replace(/\\/g, "/");
  const hash = fnv1a32(normalizedPath);
  const shard = hash % shardCount;

  return shard.toString(32).padStart(2, "0");
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}
