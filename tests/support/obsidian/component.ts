export type EventRef = { detach(): void };

/**
 * Component with the registration bookkeeping Obsidian performs: everything
 * passed to a `register*` method is released on `unload`, which is what makes
 * leak tests for views and plugins observable.
 */
export class Component {
  private readonly cleanups: (() => void)[] = [];
  private loaded = false;
  private readonly childCleanups = new Map<Component, () => void>();

  async load(): Promise<void> {
    this.loaded = true;
    await this.onload();
  }

  unload(): void {
    this.loaded = false;
    while (this.cleanups.length > 0) this.cleanups.pop()?.();
    this.onunload();
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  register(cleanup: () => void): void {
    this.cleanups.push(cleanup);
  }

  registerEvent(eventRef: EventRef): void {
    this.register(() => eventRef.detach());
  }

  registerInterval(id: number): number {
    this.register(() => window.clearInterval(id));
    return id;
  }

  registerDomEvent(
    element: HTMLElement | Window | Document,
    type: string,
    handler: EventListener,
  ): void {
    element.addEventListener(type, handler);
    this.register(() => element.removeEventListener(type, handler));
  }

  addChild<T extends Component>(child: T): T {
    const cleanup = (): void => child.unload();
    this.childCleanups.set(child, cleanup);
    this.register(cleanup);
    void child.load();
    return child;
  }

  removeChild<T extends Component>(child: T): T {
    const cleanup = this.childCleanups.get(child);
    if (!cleanup) return child;
    this.childCleanups.delete(child);
    this.cleanups.splice(this.cleanups.indexOf(cleanup), 1);
    child.unload();
    return child;
  }

  registrationCount(): number {
    return this.cleanups.length;
  }

  onload(): void | Promise<void> {}

  onunload(): void {}
}
