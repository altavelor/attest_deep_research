export class TAbstractFile {
  constructor(public path: string) {}
}

export class TFile extends TAbstractFile {
  stat: { size: number; mtime: number; ctime: number };

  constructor(path: string, stat: { size?: number; mtime?: number } = {}) {
    super(path);
    this.stat = { size: stat.size ?? 0, mtime: stat.mtime ?? 0, ctime: 0 };
  }
}

export class TFolder extends TAbstractFile {}

export class App {}

export class Modal {}

export class Notice {
  constructor(public message: string) {}
}

export function requestUrl(): never {
  throw new Error("requestUrl is not available in tests.");
}

export function setIcon(): void {}
