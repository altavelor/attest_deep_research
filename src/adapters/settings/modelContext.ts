export function contextLengthInputAfterDiscovery(
  currentValue: string,
  discoveredValue: number | undefined,
): string {
  return discoveredValue === undefined ? currentValue : String(discoveredValue);
}
