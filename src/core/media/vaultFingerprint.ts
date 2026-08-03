export function vaultFileFingerprint(sizeBytes: number, modifiedTime: number): string {
  return `stat:${nonNegativeInteger(sizeBytes)}:${nonNegativeInteger(modifiedTime)}`;
}

export function isVaultFileFingerprint(value: string | undefined): boolean {
  return typeof value === "string" && value.startsWith("stat:");
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
