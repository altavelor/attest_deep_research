import type { OnboardingScope, OnboardingSearchMode, OnboardingStep } from "./types";

export const ONBOARDING_SCOPES: readonly OnboardingScope[] = [
  "notesAndWeb",
  "webOnly",
  "notesOnly",
];

const VAULT_STEPS: readonly OnboardingStep[] = ["chat", "scope", "embedding", "folders"];
const WEB_ONLY_STEPS: readonly OnboardingStep[] = ["chat", "scope"];

export function scopeNeedsIndex(scope: OnboardingScope): boolean {
  return scope !== "webOnly";
}

/**
 * Steps the wizard still has to show. While no scope is picked the longest
 * route is assumed, so the progress indicator only ever shrinks once the user
 * chooses, and never grows under them.
 */
export function stepsForScope(scope: OnboardingScope | undefined): readonly OnboardingStep[] {
  if (scope === undefined) {
    return VAULT_STEPS;
  }

  return scopeNeedsIndex(scope) ? VAULT_STEPS : WEB_ONLY_STEPS;
}

/** One-based position of a step on the route, or zero when the route omits it. */
export function stepPosition(scope: OnboardingScope | undefined, step: OnboardingStep): number {
  return stepsForScope(scope).indexOf(step) + 1;
}

export function nextStep(
  scope: OnboardingScope | undefined,
  step: OnboardingStep,
): OnboardingStep | undefined {
  const steps = stepsForScope(scope);
  const index = steps.indexOf(step);
  return index < 0 ? undefined : steps[index + 1];
}

export function previousStep(
  scope: OnboardingScope | undefined,
  step: OnboardingStep,
): OnboardingStep | undefined {
  const steps = stepsForScope(scope);
  const index = steps.indexOf(step);
  return index <= 0 ? undefined : steps[index - 1];
}

export function searchModeForScope(scope: OnboardingScope): OnboardingSearchMode {
  switch (scope) {
    case "webOnly":
      return "webOnly";
    case "notesOnly":
      return "indexOnly";
    case "notesAndWeb":
      return "indexAndWeb";
  }
}

/**
 * Rejects an index location that would leave the vault. The wizard is the only
 * place this path is typed by hand, so traversal is refused before the draft
 * can become an index profile. An empty value is allowed: it falls back to the
 * default location.
 */
export function isVaultContainedFolder(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }

  if (trimmed.includes("\\") || trimmed.startsWith("/")) {
    return false;
  }

  return !trimmed.split("/").includes("..");
}
