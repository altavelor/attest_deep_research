import type { CapabilityVerificationPhase, CapabilityVerificationState } from "@adapters/settings";
import type { MessageKey, Translate } from "@adapters/i18n";

const PHASE_MESSAGE_KEYS: Record<CapabilityVerificationPhase, MessageKey> = {
  testing: "settings.capability.phase.testing",
  verified: "settings.capability.phase.verified",
  advertised: "settings.capability.phase.advertised",
  "not-verified": "settings.capability.phase.notVerified",
  failed: "settings.capability.phase.failed",
  "not-tested": "settings.capability.phase.notTested",
};

/** One line per capability subject, for a column layout. */
export function capabilityStatusLines(t: Translate, state: CapabilityVerificationState): string[] {
  return [
    capabilityEntry(t, "settings.capability.subject.tools", state.tools),
    capabilityEntry(t, "settings.capability.subject.agent", state.agent),
  ];
}

/** Localized rendering of a chat-profile capability verification state. */
export function formatCapabilityStatus(t: Translate, state: CapabilityVerificationState): string {
  return t("settings.capability.status", {
    tools: capabilityEntry(t, "settings.capability.subject.tools", state.tools),
    agent: capabilityEntry(t, "settings.capability.subject.agent", state.agent),
  });
}

function capabilityEntry(
  t: Translate,
  subjectKey: MessageKey,
  phase: CapabilityVerificationPhase,
): string {
  return t("settings.capability.entry", {
    subject: t(subjectKey),
    phase: t(PHASE_MESSAGE_KEYS[phase]),
  });
}
