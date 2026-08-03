export type EventRef = { detach(): void };

/**
 * Component with the registration bookkeeping Obsidian performs: everything
 * passed to a `register*` method is released on `unload`, which is what makes
 * leak tests for views and plugins observable.
 */
export class Component {
  private readonly cleanups: (() => void)[] = [];
  private loaded = false;

  load(): void {
    this.loaded = true;
    this.onload();
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
    this.register(() => child.unload());
    child.load();
    return child;
  }

  registrationCount(): number {
    return this.cleanups.length;
  }

  onload(): void {}

  onunload(): void {}
}
