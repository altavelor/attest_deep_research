import type { EnSettingsProfilesMessages } from "../en/settingsProfiles";

export const settingsProfiles: EnSettingsProfilesMessages = {
  "settings.status.suspended": "Ausgesetzt",

  "settings.profileList.addAction": "{title} hinzufügen",
  "settings.profileList.column.profile": "Profil",
  "settings.profileList.column.status": "Status",
  "settings.profileList.column.actions": "Aktionen",
  "settings.profileList.editAction": "Profil bearbeiten",
  "settings.profileList.tag.agent": "Agent",
  "settings.profileList.tag.tools": "Tools",
  "settings.profileList.tag.instant": "Sofort",

  "settings.capability.status": "{tools} · {agent}",
  "settings.capability.entry": "{subject}: {phase}",
  "settings.capability.subject.tools": "Werkzeug-Unterstützung",
  "settings.capability.subject.agent": "Agentenmodus-Unterstützung",
  "settings.capability.phase.testing": "Test läuft…",
  "settings.capability.phase.verified": "Bestätigt",
  "settings.capability.phase.advertised": "Vom Anbieter angegeben",
  "settings.capability.phase.notVerified": "Nicht bestätigt",
  "settings.capability.phase.failed": "Fehlgeschlagen",
  "settings.capability.phase.notTested": "Nicht getestet",

  "settings.models.heading": "Modellprofile",
  "settings.models.desc":
    "Anbieter-Endpunkte sowie die Chat- und Embedding-Modelle einrichten, die sie nutzen.",
  "settings.models.server.title": "Serverprofile",
  "settings.models.server.deleteTooltip": "Serverprofil löschen",
  "settings.models.server.deleteBlockedTooltip": "Zuerst abhängige Modellprofile löschen",
  "settings.models.server.deleteBlockedNotice": "Zuerst abhängige Modellprofile löschen.",
  "settings.models.chat.title": "Chat-Modell-Profile",
  "settings.models.chat.deleteTooltip": "Chat-Modell-Profil löschen",
  "settings.models.chat.testingLabel": "Fähigkeiten werden getestet…",
  "settings.models.chat.testingNotice": "Fähigkeiten für {profile} werden getestet.",
  "settings.models.embedding.title": "Embedding-Modell-Profile",
  "settings.models.embedding.deleteTooltip": "Embedding-Modell-Profil löschen",
  "settings.models.embedding.deleteBlockedTooltip":
    "Dieses Embedding-Modell wird von einem Indexprofil verwendet",
  "settings.models.embedding.deleteBlockedNotice":
    "Dieses Embedding-Modell wird von einem Indexprofil verwendet.",
  "settings.models.embedding.defaultBadge": "Standard",
  "settings.models.embedding.defaultBadgeTitle": "Standard-Embedding-Modell",
  "settings.models.embedding.defaultAction": "Standardmodell",
  "settings.models.embedding.setDefaultAction": "Als Standardmodell festlegen",

  "settings.prober.capabilityDetectionFailed":
    "Erkennung der Fähigkeiten für {profile} fehlgeschlagen.",
  "settings.prober.toolCapabilityDetectionFailed":
    "Erkennung der Tool-Fähigkeiten für {profile} fehlgeschlagen.",
  "settings.prober.agentCapabilityDetectionFailed":
    "Erkennung der Agent-Modus-Fähigkeit für {profile} fehlgeschlagen.",

  "settings.profileModal.error.requiredFields": "Alle Pflichtfelder ausfüllen.",
  "settings.profileModal.error.nameLength": "Der Name muss 1–{max} Zeichen lang sein.",
  "settings.profileModal.error.nameUnique": "Der Name muss eindeutig sein.",

  "settings.serverModal.editTitle": "Serverprofil bearbeiten",
  "settings.serverModal.addTitle": "Serverprofil hinzufügen",
  "settings.serverModal.preset.name": "Anbieter",
  "settings.serverModal.preset.desc":
    "Füllt Basis-URL und API-Format eines bekannten Anbieters aus. Für jeden anderen Endpunkt „Benutzerdefiniert“ wählen.",
  "settings.serverModal.preset.custom": "Benutzerdefiniert",
  "settings.serverModal.name.name": "Name",
  "settings.serverModal.name.desc":
    "Lesbarer Name, der in den Einstellungen und in Modellauswahlfeldern angezeigt wird. Maximal {max} Zeichen.",
  "settings.serverModal.apiFormat.name": "API-Format",
  "settings.serverModal.apiFormat.desc": "Format der Anfragen und Antworten dieses Anbieters.",
  "settings.serverModal.apiFormat.openaiCompatible": "OpenAI-kompatibel",
  "settings.serverModal.apiFormat.ollama": "Ollama",
  "settings.serverModal.apiFormat.anthropic": "Anthropic",
  "settings.serverModal.baseUrl.name": "Basis-URL",
  "settings.serverModal.baseUrl.desc":
    "URL des Anbieter-Endpunkts, zum Beispiel eine API-Basis von OpenRouter, Ollama oder Anthropic.",
  "settings.serverModal.apiKey.name": "API-Schlüssel",
  "settings.serverModal.apiKey.desc":
    "Optional. Wird als Bearer-Token für Anbieter verwendet, die eine Authentifizierung verlangen.",

  "settings.modelProfileModal.editTitle.chat": "Chat-Modell-Profil bearbeiten",
  "settings.modelProfileModal.editTitle.embedding": "Embedding-Modell-Profil bearbeiten",
  "settings.modelProfileModal.addTitle.chat": "Chat-Modell-Profil hinzufügen",
  "settings.modelProfileModal.addTitle.embedding": "Embedding-Modell-Profil hinzufügen",
  "settings.modelProfileModal.name.name": "Name",
  "settings.modelProfileModal.name.desc":
    "Lesbarer Name, der in den Einstellungen und in den Chat-Bedienelementen angezeigt wird. Maximal {max} Zeichen.",
  "settings.modelProfileModal.server.name": "Server",
  "settings.modelProfileModal.server.desc":
    "Anbieter-Endpunkt, über den dieses Modell aufgerufen wird.",
  "settings.modelProfileModal.model.name": "Modell",
  "settings.modelProfileModal.model.desc":
    "Modellname, der vom ausgewählten Serverprofil abgerufen wird.",
  "settings.modelProfileModal.model.placeholder": "Modelle abrufen, dann zum Filtern tippen",
  "settings.modelProfileModal.model.fetch": "Abrufen",
  "settings.modelProfileModal.model.empty": "Keine passenden Modelle",
  "settings.modelProfileModal.temperature.name": "Temperatur",
  "settings.modelProfileModal.temperature.desc":
    "Optional. Steuert die Zufälligkeit der Antwort; leer nutzt den Standard des Anbieters oder der App.",
  "settings.modelProfileModal.maxTokens.name": "Maximale Token",
  "settings.modelProfileModal.maxTokens.desc":
    "Optional. Begrenzt die Antwortlänge; leer nutzt den Standard von Anbieter/Modell oder 4096 bei Anthropic.",
  "settings.modelProfileModal.contextSize.name": "Kontextgröße",
  "settings.modelProfileModal.contextSize.desc":
    "Optionales Token-Limit. Wird nach Möglichkeit aus den Modell-Metadaten gefüllt und zur Durchsetzung des Kontextfensters im Chat genutzt.",
  "settings.modelProfileModal.error.selectServer": "Zuerst ein Serverprofil auswählen.",
  "settings.modelProfileModal.error.activeServer": "Ein aktives Serverprofil auswählen.",
  "settings.modelProfileModal.error.fetchModels":
    "Vor dem Anlegen eines Modellprofils die Modelle abrufen.",
  "settings.modelProfileModal.error.reasoningEffort":
    "Der Reasoning-Aufwand muss dem Anbieterstandard entsprechen oder als Fähigkeit bestätigt sein.",
  "settings.modelProfileModal.error.reasoningSummary":
    "Reasoning-Zusammenfassungen wurden für dieses Profil nicht bestätigt.",

  "settings.capabilityControls.heading": "Fähigkeiten",
  "settings.capabilityControls.testTooltip": "Fähigkeiten testen — {status}",
  "settings.capabilityControls.testingTooltip": "Fähigkeitstest läuft …",
  "settings.capabilityControls.retestTooltip": "Fähigkeiten erneut testen — {status}",
  "settings.capabilityControls.agentic.name": "Agentenmodus",
  "settings.capabilityControls.agentic.desc":
    "Bestätigte Unterstützung des Agent-Modus aktivieren.",
  "settings.capabilityControls.effort.name": "Reasoning-Aufwand",
  "settings.capabilityControls.effort.desc":
    "Auto nutzt den Anbieterstandard oder einen bestätigten Wert.",
  "settings.capabilityControls.effort.auto": "Auto",
  "settings.capabilityControls.effort.enableAgentic":
    "Agentenmodus aktivieren, um einen Reasoning-Aufwand zu wählen.",
  "settings.capabilityControls.tools.name": "Tools",
  "settings.capabilityControls.tools.desc":
    "Diesem Modell erlauben, Notiz-Tools aufzurufen — Vault-Notizen lesen, durchsuchen und (mit Schreibrechten) ändern. Index- und Web-Recherche-Tools im Modus Denken werden getrennt geregelt.",
  "settings.capabilityControls.notVerified": "Vom Fähigkeitstest nicht bestätigt.",
  "settings.capabilityControls.notTested": "Noch nicht getestet.",
};
