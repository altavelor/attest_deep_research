export class RenderVersionTracker {
  private currentVersion = 0;

  next(): number {
    this.currentVersion += 1;
    return this.currentVersion;
  }

  isCurrent(version: number): boolean {
    return this.currentVersion === version;
  }
}
