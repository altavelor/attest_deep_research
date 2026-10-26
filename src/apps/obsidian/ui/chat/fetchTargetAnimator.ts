export class FetchTargetAnimator {
  private readonly timers = new Set<number>();

  start(targetList: HTMLElement, targetElements: HTMLElement[]): void {
    let index = 0;
    const showNextTarget = (): void => {
      if (!targetList.isConnected) return;
      targetElements.forEach((targetEl, targetIndex) => {
        targetEl.toggleClass("attest-chat__tool-fetch-target--active", targetIndex === index);
      });
      index = (index + 1) % targetElements.length;
      const timer = window.setTimeout(() => {
        this.timers.delete(timer);
        showNextTarget();
      }, 1_000);
      this.timers.add(timer);
    };
    showNextTarget();
  }

  dispose(): void {
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
  }
}
