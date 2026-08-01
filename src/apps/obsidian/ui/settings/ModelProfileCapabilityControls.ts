import {
  CapabilityVerificationState,
  ChatModelProfile,
  formatCapabilityVerificationStatus,
  formatEffortLabel,
  reasoningVerified,
  toolsVerified,
  verificationBlockReason,
} from "@adapters/settings";
import { Setting } from "obsidian";

type ReasoningCapabilities = ChatModelProfile["reasoningCapabilities"];

export interface ModelProfileCapabilityControlsOptions {
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
  const capabilityStatus = formatCapabilityStatus(
    options.savedProfileId,
    options.getCapabilityStatus,
    options.currentProfile,
  );
  const capabilityHeading = new Setting(options.containerEl).setName("Capabilities").setHeading();
  capabilityHeading.settingEl.addClass("ixplorer-profile-modal__capabilities-heading");
  capabilityHeading.setDesc(capabilityStatus).addButton((button) =>
    button
      .setIcon("flask-conical")
      .setTooltip(
        `${hasCapabilityTestResult(options.currentProfile) ? "Re-test" : "Test"} capabilities — ${capabilityStatus}`,
      )
      .onClick(options.onCapabilityTest),
  );

  renderReasoningControls(options);
}

function renderReasoningControls(options: ModelProfileCapabilityControlsOptions): void {
  const verified = reasoningVerified(options.reasoningCapabilities);
  let reasoningMode = options.reasoningMode;
  if (!verified) {
    reasoningMode = "off";
  } else if (!options.agentVerifiedSeen) {
    reasoningMode = "on";
  }
  options.onReasoningModeChange(reasoningMode);
  options.onAgentVerifiedSeenChange(verified);

  const reason = verificationBlockReason(
    verified,
    options.reasoningCapabilities?.source === "probe",
  );
  const agenticSetting = new Setting(options.containerEl)
    .setName("Agentic mode")
    .setDesc("Enable verified agent mode support.")
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
      ? "Enable agentic mode to choose a reasoning effort."
      : undefined;
  const effortSetting = new Setting(options.containerEl)
    .setName("Reasoning effort")
    .setDesc("Auto uses the provider default or a verified value.")
    .addDropdown((dropdown) => {
      dropdown.addOption("", "Auto");
      for (const effort of effortValues) dropdown.addOption(effort, formatEffortLabel(effort));
      dropdown.setValue(options.reasoningEffort).onChange(options.onReasoningEffortChange);
      dropdown.setDisabled(effortDisabled);
    });
  applyDisabledState(effortSetting, effortDisabled, effortReason);
}

export function renderModelProfileToolsControl(
  options: ModelProfileCapabilityControlsOptions,
): void {
  const verified = options.currentProfile ? toolsVerified(options.currentProfile) : false;
  if (!verified) {
    options.onToolsEnabledChange(false);
  }
  const reason = verificationBlockReason(
    verified,
    Boolean(options.currentProfile?.capabilities?.toolCalling?.probe),
  );
  const toolsSetting = new Setting(options.containerEl)
    .setName("Tools")
    .setDesc(
      "Let this model call note tools — read, search, and (with edit access) modify vault notes. " +
        "Index and web research tools in Thinking mode are governed separately.",
    )
    .addToggle((toggle) => {
      toggle.setValue(options.toolsEnabled);
      toggle.setDisabled(!verified);
      toggle.onChange(options.onToolsEnabledChange);
    });
  applyDisabledState(toolsSetting, !verified, reason);
}

function formatCapabilityStatus(
  savedProfileId: string | undefined,
  getCapabilityStatus: ((profileId: string) => CapabilityVerificationState) | undefined,
  profile: ChatModelProfile | undefined,
): string {
  const status = savedProfileId ? getCapabilityStatus?.(savedProfileId) : undefined;
  if (status) return formatCapabilityVerificationStatus(status);

  const tools = profile?.capabilities?.toolCalling?.probe;
  const agent = profile?.reasoningCapabilities;
  const toolStatus = !tools
    ? "tools support: Not tested"
    : tools.calls
      ? "tools support: Verified"
      : "tools support: Not verified";
  const agentStatus =
    !agent || agent.source !== "probe"
      ? "agent mode support: Not tested"
      : agent.responses
        ? "agent mode support: Verified"
        : "agent mode support: Not verified";
  return `${toolStatus} · ${agentStatus}`;
}

function hasCapabilityTestResult(profile: ChatModelProfile | undefined): boolean {
  return Boolean(
    profile?.capabilities?.toolCalling?.probe || profile?.reasoningCapabilities?.source === "probe",
  );
}

function applyDisabledState(setting: Setting, disabled: boolean, reason: string | undefined): void {
  if (!disabled) return;
  setting.settingEl.addClass("ixplorer-profile-modal__setting--disabled");
  if (reason) {
    setting.descEl.createDiv({ cls: "ixplorer-profile-modal__warning", text: reason });
  }
}
