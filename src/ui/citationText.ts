export function stripRenderedCitationIds(value: string): string {
  return value.replace(/\s*\[[^\]\n]{8,}\]/g, "");
}
