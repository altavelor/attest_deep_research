import type { SubAgentInspectionSnapshot } from "@application/contracts/subAgentInspection";
import type { SubAgentInspectionPort } from "@application/ports/subAgent";

/**
 * Follows the inspection snapshot of the selected chat for the composer button. A rebind
 * forgets the previous chat at once, and a fenced generation keeps a late answer of the
 * old port from reaching the new chat; a failed read keeps the last confirmed state.
 */
export class SubAgentCountTracker {
  private port: SubAgentInspectionPort | null = null;
  private chatKey: string | null = null;
  private snapshot: SubAgentInspectionSnapshot | null = null;
  private unsubscribe: (() => void) | null = null;
  private generation = 0;
  private readFailed = false;

  constructor(private readonly onChange: () => void) {}

  get boundChat(): string | null {
    return this.chatKey;
  }

  get loaded(): boolean {
    return (
      this.snapshot !== null || this.readFailed || (this.chatKey !== null && this.port === null)
    );
  }

  get activeCount(): number {
    return this.snapshot?.activeCount ?? 0;
  }

  get hasAgentRuns(): boolean {
    return this.snapshot?.hasAgentRuns === true;
  }

  bind(chatKey: string, port: SubAgentInspectionPort | null): void {
    if (this.chatKey === chatKey && this.port === port) return;
    this.release();
    this.chatKey = chatKey;
    this.port = port;
    if (!port) {
      this.onChange();
      return;
    }
    const generation = this.generation;
    this.unsubscribe = port.subscribe((snapshot) => this.accept(generation, snapshot));
    this.onChange();
    port.snapshot().then(
      (snapshot) => this.accept(generation, snapshot),
      () => {
        if (generation !== this.generation) return;
        this.readFailed = true;
        this.onChange();
      },
    );
  }

  release(): void {
    this.generation += 1;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.port = null;
    this.chatKey = null;
    this.snapshot = null;
    this.readFailed = false;
  }

  private accept(generation: number, snapshot: SubAgentInspectionSnapshot): void {
    if (generation !== this.generation) return;
    if (this.snapshot && snapshot.revision < this.snapshot.revision) return;
    this.snapshot = snapshot;
    this.onChange();
  }
}
