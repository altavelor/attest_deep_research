import {
  CapabilityVerificationState,
  ChatModelProfile,
  formatEffortLabel,
  reasoningVerified,
  toolsVerified,
} from "@adapters/settings";
import { Setting } from "obsidian";
import type { Translate } from "@adapters/i18n";
import { formatCapabilityStatus } from "./capabilityStatusText";

type ReasoningCapabilities = ChatModelProfile["reasoningCapabilities"];

export interface ModelProfileCapabilityControlsOptions {
  t: Translate;
  containerEl: HTMLElement;
  currentProfile: ChatModelProfile | undefined;
  savedProfileId: string | undefined;
  getCapabilityStatus?: (profileId: string) => CapabilityVerificationState;
  reasoningCapabilities: ReasoningCapabilities;
  reasoningMode: "off" | "on" | "auto";
  reasoningEffort: string;
  toolsEnabled: boolean;
  agentVerifiedSeen: boolean;
  onCapabilityTest: () => void;
  onReasoningModeChange: (mode: "off" | "on" | "auto") => void;
  onReasoningEffortChange: (effort: string) => void;
  onToolsEnabledChange: (enabled: boolean) => void;
  onAgentVerifiedSeenChange: (verified: boolean) => void;
  onRequestRerender: () => void;
}

/** Renders the capability status and controls for a chat-model profile. */
export function renderModelProfileCapabilityControls(
  options: ModelProfileCapabilityControlsOptions,
): void {
  const { t } = options;
  const capabilityStatus = resolveCapabilityStatus(options);
  const capabilityHeading = new Setting(options.containerEl)
    .setName(t("settings.capabilityControls.heading"))
    .setHeading();
  capabilityHeading.settingEl.addClass("attest-profile-modal__capabilities-heading");
  capabilityHeading.setDesc(capabilityStatus).addButton((button) =>
    button
      .setIcon("flask-conical")
      .setTooltip(
        hasCapabilityTestResult(options.currentProfile)
          ? t("settings.capabilityControls.retestTooltip", { status: capabilityStatus })
          : t("settings.capabilityControls.testTooltip", { status: capabilityStatus }),
      )
      .onClick(options.onCapabilityTest),
  );

  renderReasoningControls(options);
}

function renderReasoningControls(options: ModelProfileCapabilityControlsOptions): void {
  const { t } = options;
  const verified = reasoningVerified(options.reasoningCapabilities);
  let reasoningMode = options.reasoningMode;
  if (!verified) {
    reasoningMode = "off";
  } else if (!options.agentVerifiedSeen) {
    reasoningMode = "on";
  }
  options.onReasoningModeChange(reasoningMode);
  options.onAgentVerifiedSeenChange(verified);

  const reason = blockReason(t, verified, options.reasoningCapabilities?.source === "probe");
  const agenticSetting = new Setting(options.containerEl)
    .setName(t("settings.capabilityControls.agentic.name"))
    .setDesc(t("settings.capabilityControls.agentic.desc"))
    .addToggle((toggle) => {
      toggle.setValue(reasoningMode === "on");
      toggle.setDisabled(!verified);
      toggle.onChange((value) => {
        options.onReasoningModeChange(value ? "on" : "off");
        options.onRequestRerender();
      });
    });
  applyDisabledState(agenticSetting, !verified, reason);

  const effortValues = new Set(options.reasoningCapabilities?.efforts ?? []);
  if (options.reasoningEffort) effortValues.add(options.reasoningEffort);
  const effortDisabled = !verified || reasoningMode === "off";
  const effortReason = !verified
    ? reason
    : reasoningMode === "off"
      ? t("settings.capabilityControls.effort.enableAgentic")
      : undefined;
  const effortSetting = new Setting(options.containerEl)
    .setName(t("settings.capabilityControls.effort.name"))
    .setDesc(t("settings.capabilityControls.effort.desc"))
    .addDropdown((dropdown) => {
      dropdown.addOption("", t("settings.capabilityControls.effort.auto"));
      for (const effort of effortValues) dropdown.addOption(effort, formatEffortLabel(effort));
      dropdown.setValue(options.reasoningEffort).onChange(options.onReasoningEffortChange);
      dropdown.setDisabled(effortDisabled);
    });
  applyDisabledState(effortSetting, effortDisabled, effortReason);
}

export function renderModelProfileToolsControl(
  options: ModelProfileCapabilityControlsOptions,
): void {
  const { t } = options;
  const verified = options.currentProfile ? toolsVerified(options.currentProfile) : false;
  if (!verified) {
    options.onToolsEnabledChange(false);
  }
  const reason = blockReason(
    t,
    verified,
    Boolean(options.currentProfile?.capabilities?.toolCalling?.probe),
  );
  const toolsSetting = new Setting(options.containerEl)
    .setName(t("settings.capabilityControls.tools.name"))
    .setDesc(t("settings.capabilityControls.tools.desc"))
    .addToggle((toggle) => {
      toggle.setValue(options.toolsEnabled);
      toggle.setDisabled(!verified);
      toggle.onChange(options.onToolsEnabledChange);
    });
  applyDisabledState(toolsSetting, !verified, reason);
}

function blockReason(t: Translate, verified: boolean, tested: boolean): string | undefined {
  if (verified) return undefined;
  return tested
    ? t("settings.capabilityControls.notVerified")
    : t("settings.capabilityControls.notTested");
}

function resolveCapabilityStatus(options: ModelProfileCapabilityControlsOptions): string {
  const { t } = options;
  const status = options.savedProfileId
    ? options.getCapabilityStatus?.(options.savedProfileId)
    : undefined;
  if (status) return formatCapabilityStatus(t, status);

  const tools = options.currentProfile?.capabilities?.toolCalling?.probe;
  const agent = options.currentProfile?.reasoningCapabilities;
  return formatCapabilityStatus(t, {
    tools: !tools ? "not-tested" : tools.calls ? "verified" : "not-verified",
    agent:
      !agent || agent.source !== "probe"
        ? "not-tested"
        : agent.responses
          ? "verified"
          : "not-verified",
  });
}

function hasCapabilityTestResult(profile: ChatModelProfile | undefined): boolean {
  return Boolean(
    profile?.capabilities?.toolCalling?.probe || profile?.reasoningCapabilities?.source === "probe",
  );
}

function applyDisabledState(setting: Setting, disabled: boolean, reason: string | undefined): void {
  if (!disabled) return;
  setting.settingEl.addClass("attest-profile-modal__setting--disabled");
  if (reason) {
    setting.descEl.createDiv({ cls: "attest-profile-modal__warning", text: reason });
  }
}
