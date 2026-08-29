export const settingsProfiles = {
  "settings.status.suspended": "Suspended",

  "settings.profileList.addAction": "Add {title}",
  "settings.profileList.column.profile": "Profile",
  "settings.profileList.column.status": "Status",
  "settings.profileList.column.actions": "Actions",
  "settings.profileList.editAction": "Edit profile",
  "settings.profileList.tag.agent": "Agent",
  "settings.profileList.tag.tools": "Tools",
  "settings.profileList.tag.instant": "Instant",

  "settings.capability.status": "{tools} · {agent}",
  "settings.capability.entry": "{subject}: {phase}",
  "settings.capability.subject.tools": "Tools support",
  "settings.capability.subject.agent": "Agent mode support",
  "settings.capability.phase.testing": "Testing…",
  "settings.capability.phase.verified": "Verified",
  "settings.capability.phase.advertised": "Reported by provider",
  "settings.capability.phase.notVerified": "Not verified",
  "settings.capability.phase.failed": "Failed",
  "settings.capability.phase.notTested": "Not tested",

  "settings.models.heading": "Model profiles",
  "settings.models.desc":
    "Configure provider endpoints and the chat or embedding models that use them.",
  "settings.models.server.title": "Server profiles",
  "settings.models.server.deleteTooltip": "Delete server profile",
  "settings.models.server.deleteBlockedTooltip": "Delete dependent model profiles first",
  "settings.models.server.deleteBlockedNotice": "Delete dependent model profiles first.",
  "settings.models.chat.title": "Chat model profiles",
  "settings.models.chat.deleteTooltip": "Delete chat model profile",
  "settings.models.chat.testingLabel": "Testing capabilities…",
  "settings.models.chat.testingNotice": "Testing capabilities for {profile}.",
  "settings.models.embedding.title": "Embedding model profiles",
  "settings.models.embedding.deleteTooltip": "Delete embedding model profile",
  "settings.models.embedding.deleteBlockedTooltip":
    "This embedding model is used by an index profile",
  "settings.models.embedding.deleteBlockedNotice":
    "This embedding model is used by an index profile.",
  "settings.models.embedding.defaultBadge": "Default",
  "settings.models.embedding.defaultBadgeTitle": "Default embedding model",
  "settings.models.embedding.defaultAction": "Default model",
  "settings.models.embedding.setDefaultAction": "Set as default model",

  "settings.prober.capabilityDetectionFailed": "Capability detection failed for {profile}.",
  "settings.prober.toolCapabilityDetectionFailed":
    "Tool capability detection failed for {profile}.",
  "settings.prober.agentCapabilityDetectionFailed":
    "Agent mode capability detection failed for {profile}.",

  "settings.profileModal.error.requiredFields": "Fill all required fields.",
  "settings.profileModal.error.nameLength": "Name must be 1-{max} characters.",
  "settings.profileModal.error.nameUnique": "Name must be unique.",

  "settings.serverModal.editTitle": "Edit server profile",
  "settings.serverModal.addTitle": "Add server profile",
  "settings.serverModal.preset.name": "Provider",
  "settings.serverModal.preset.desc":
    "Fills the base URL and API format for a known provider. Choose Custom for any other endpoint.",
  "settings.serverModal.preset.custom": "Custom",
  "settings.serverModal.name.name": "Name",
  "settings.serverModal.name.desc":
    "Human-readable name shown in settings and model selectors. Max {max} characters.",
  "settings.serverModal.apiFormat.name": "API format",
  "settings.serverModal.apiFormat.desc": "Request and response format used by this provider.",
  "settings.serverModal.apiFormat.openaiCompatible": "OpenAI-compatible",
  "settings.serverModal.apiFormat.ollama": "Ollama",
  "settings.serverModal.apiFormat.anthropic": "Anthropic",
  "settings.serverModal.baseUrl.name": "Base URL",
  "settings.serverModal.baseUrl.desc":
    "Provider endpoint URL, for example an OpenRouter, Ollama, or Anthropic API base.",
  "settings.serverModal.apiKey.name": "API key",
  "settings.serverModal.apiKey.desc":
    "Optional. Used as a bearer token for providers that require authentication.",

  "settings.modelProfileModal.editTitle.chat": "Edit chat model profile",
  "settings.modelProfileModal.editTitle.embedding": "Edit embedding model profile",
  "settings.modelProfileModal.addTitle.chat": "Add chat model profile",
  "settings.modelProfileModal.addTitle.embedding": "Add embedding model profile",
  "settings.modelProfileModal.name.name": "Name",
  "settings.modelProfileModal.name.desc":
    "Human-readable name shown in settings and chat controls. Max {max} characters.",
  "settings.modelProfileModal.server.name": "Server",
  "settings.modelProfileModal.server.desc": "Provider endpoint used to call this model.",
  "settings.modelProfileModal.model.name": "Model",
  "settings.modelProfileModal.model.desc": "Model name fetched from the selected server profile.",
  "settings.modelProfileModal.model.placeholder": "Fetch models, then type to filter",
  "settings.modelProfileModal.model.fetch": "Fetch",
  "settings.modelProfileModal.model.empty": "No matching models",
  "settings.modelProfileModal.temperature.name": "Temperature",
  "settings.modelProfileModal.temperature.desc":
    "Optional. Controls response randomness; blank uses the provider or app default.",
  "settings.modelProfileModal.maxTokens.name": "Max tokens",
  "settings.modelProfileModal.maxTokens.desc":
    "Optional. Limits response length; blank uses provider/model default or 4096 for Anthropic.",
  "settings.modelProfileModal.contextSize.name": "Context size",
  "settings.modelProfileModal.contextSize.desc":
    "Optional token limit. Filled from model metadata when available and used to enforce the chat context window.",
  "settings.modelProfileModal.error.selectServer": "Select a server profile first.",
  "settings.modelProfileModal.error.activeServer": "Select an active server profile.",
  "settings.modelProfileModal.error.fetchModels": "Fetch models before creating a model profile.",
  "settings.modelProfileModal.error.reasoningEffort":
    "Reasoning effort must be provider-default or capability-verified.",
  "settings.modelProfileModal.error.reasoningSummary":
    "Reasoning summaries were not verified for this profile.",

  "settings.capabilityControls.heading": "Capabilities",
  "settings.capabilityControls.testTooltip": "Test capabilities — {status}",
  "settings.capabilityControls.testingTooltip": "Capability test in progress…",
  "settings.capabilityControls.retestTooltip": "Re-test capabilities — {status}",
  "settings.capabilityControls.agentic.name": "Agentic mode",
  "settings.capabilityControls.agentic.desc": "Enable verified agent mode support.",
  "settings.capabilityControls.effort.name": "Reasoning effort",
  "settings.capabilityControls.effort.desc": "Auto uses the provider default or a verified value.",
  "settings.capabilityControls.effort.auto": "Auto",
  "settings.capabilityControls.effort.enableAgentic":
    "Enable agentic mode to choose a reasoning effort.",
  "settings.capabilityControls.tools.name": "Tools",
  "settings.capabilityControls.tools.desc":
    "Let this model call note tools — read, search, and (with edit access) modify vault notes. Index and web research tools in Thinking mode are governed separately.",
  "settings.capabilityControls.notVerified": "Not verified by the capability test.",
  "settings.capabilityControls.notTested": "Not tested yet.",
};

export type EnSettingsProfilesMessages = Record<keyof typeof settingsProfiles, string>;
