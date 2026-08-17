import {
  CapabilityVerificationState,
  ChatModelProfile,
  ToolCapabilitySettings,
  deriveCapabilityVerificationState,
  formatEffortLabel,
  reasoningVerified,
  toolsVerified,
} from "@adapters/settings";
import { Setting } from "obsidian";
import type { Translate } from "@adapters/i18n";
import { capabilityStatusLines, formatCapabilityStatus } from "./capabilityStatusText";

type ReasoningCapabilities = ChatModelProfile["reasoningCapabilities"];

export interface ModelProfileCapabilityControlsOptions {
  t: Translate;
  containerEl: HTMLElement;
  currentProfile: ChatModelProfile | undefined;
  savedProfileId: string | undefined;
  savedStatusApplies: boolean;
  getCapabilityStatus?: (profileId: string) => CapabilityVerificationState;
  reasoningCapabilities: ReasoningCapabilities;
  toolCapabilities: ToolCapabilitySettings;
  reasoningMode: "off" | "on" | "auto";
  reasoningEffort: string;
  toolsEnabled: boolean;
  agentVerifiedSeen: boolean;
  toolsVerifiedSeen: boolean;
  onCapabilityTest: () => void;
  onReasoningModeChange: (mode: "off" | "on" | "auto") => void;
  onReasoningEffortChange: (effort: string) => void;
  onToolsEnabledChange: (enabled: boolean) => void;
  onAgentVerifiedSeenChange: (verified: boolean) => void;
  onToolsVerifiedSeenChange: (verified: boolean) => void;
  onRequestRerender: () => void;
}

/** Renders the capability status and controls for a chat-model profile. */
export function renderModelProfileCapabilityControls(
  options: ModelProfileCapabilityControlsOptions,
): void {
  const { t } = options;
  const capabilityStatus = resolveCapabilityStatus(options);
  const statusLines = capabilityStatusLines(options.t, capabilityVerificationState(options));
  const testing = isCapabilityTestRunning(options);
  const capabilityHeading = new Setting(options.containerEl)
    .setName(t("settings.capabilityControls.heading"))
    .setHeading();
  capabilityHeading.settingEl.addClass("attest-profile-modal__capabilities-heading");
  capabilityHeading.descEl.empty();
  for (const line of statusLines) {
    capabilityHeading.descEl.createDiv({
      cls: "attest-profile-modal__capability-status-line",
      text: line,
    });
  }
  capabilityHeading.addButton((button) => {
    button
      .setIcon("flask-conical")
      .setTooltip(
        testing
          ? t("settings.capabilityControls.testingTooltip")
          : hasCapabilityTestResult(options)
            ? t("settings.capabilityControls.retestTooltip", { status: capabilityStatus })
            : t("settings.capabilityControls.testTooltip", { status: capabilityStatus }),
      )
      .setDisabled(testing)
      .onClick(() => {
        if (!testing) options.onCapabilityTest();
      });
    button.buttonEl.addClass("attest-capability-test");
    button.buttonEl.toggleClass("is-testing", testing);
  });

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
  const verified = toolsVerified({
    capabilities: {
      chat: true,
      embeddings: false,
      detectionSource: "format-default",
      toolCalling: options.toolCapabilities,
    },
  });
  const newlyVerified =
    verified && !options.toolsVerifiedSeen && reasoningVerified(options.reasoningCapabilities);
  const toolsEnabled = !verified ? false : newlyVerified ? true : options.toolsEnabled;
  if (toolsEnabled !== options.toolsEnabled) {
    options.onToolsEnabledChange(toolsEnabled);
  }
  options.onToolsVerifiedSeenChange(verified);
  const reason = blockReason(t, verified, Boolean(options.toolCapabilities.probe));
  const toolsSetting = new Setting(options.containerEl)
    .setName(t("settings.capabilityControls.tools.name"))
    .setDesc(t("settings.capabilityControls.tools.desc"))
    .addToggle((toggle) => {
      toggle.setValue(toolsEnabled);
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

function isCapabilityTestRunning(options: ModelProfileCapabilityControlsOptions): boolean {
  const status =
    options.savedProfileId && options.savedStatusApplies
      ? options.getCapabilityStatus?.(options.savedProfileId)
      : undefined;
  return status?.tools === "testing" || status?.agent === "testing";
}

function capabilityVerificationState(
  options: ModelProfileCapabilityControlsOptions,
): CapabilityVerificationState {
  const status =
    options.savedProfileId && options.savedStatusApplies
      ? options.getCapabilityStatus?.(options.savedProfileId)
      : undefined;
  return (
    status ??
    deriveCapabilityVerificationState({
      capabilities: {
        chat: true,
        embeddings: false,
        detectionSource: "format-default",
        toolCalling: options.toolCapabilities,
      },
      reasoningCapabilities: options.reasoningCapabilities,
    })
  );
}

function resolveCapabilityStatus(options: ModelProfileCapabilityControlsOptions): string {
  return formatCapabilityStatus(options.t, capabilityVerificationState(options));
}

function hasCapabilityTestResult(options: ModelProfileCapabilityControlsOptions): boolean {
  return Boolean(
    options.toolCapabilities.probe || options.reasoningCapabilities?.source === "probe",
  );
}

function applyDisabledState(setting: Setting, disabled: boolean, reason: string | undefined): void {
  if (!disabled) return;
  setting.settingEl.addClass("attest-profile-modal__setting--disabled");
  if (reason) {
    setting.descEl.createDiv({ cls: "attest-profile-modal__warning", text: reason });
  }
}
