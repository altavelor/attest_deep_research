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

const animatorsByTranscript = new WeakMap<HTMLElement, FetchTargetAnimator>();

export function animateFetchTargets(targetList: HTMLElement, targetElements: HTMLElement[]): void {
  const transcriptEl = targetList.closest<HTMLElement>(".attest-chat__transcript");
  if (!transcriptEl) return;
  const animator = animatorsByTranscript.get(transcriptEl) ?? new FetchTargetAnimator();
  animatorsByTranscript.set(transcriptEl, animator);
  animator.start(targetList, targetElements);
}

export function disposeFetchTargetAnimations(containerEl: HTMLElement): void {
  const transcriptEl = containerEl.matches(".attest-chat__transcript")
    ? containerEl
    : containerEl.closest<HTMLElement>(".attest-chat__transcript");
  animatorsByTranscript.get(transcriptEl ?? containerEl)?.dispose();
}
