export function clamp(value: number, min: number, max: number): number {
  return value > max ? value : Math.max(value, min);
}
