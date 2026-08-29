import type { EnSettingsMessages } from "../en/settings";

export const settings: EnSettingsMessages = {
  "settings.language.heading": "Sprache",
  "settings.language.name": "Oberflächensprache",
  "settings.language.desc":
    "Sprache der Attest-Oberfläche. Wird ohne Neustart von Obsidian übernommen.",
  "settings.language.auto": "Automatisch (Obsidian folgen)",

  "settings.tab.heading": "Attest",
  "settings.tab.quickStart.title": "Schnellstart",
  "settings.tab.quickStart.steps":
    "1. Server hinzufügen → 2. Chat-Modell hinzufügen → 3. (optional) Index hinzufügen",
  "settings.tab.gateHint": "Zuerst ein Chat-Modell-Profil hinzufügen",
  "settings.tab.setup.name": "Einrichtungsassistent",
  "settings.tab.setup.rerunDesc":
    "Öffnet den Assistenten mit der aktuellen Einrichtung und aktualisiert die von ihm erstellten Profile.",
  "settings.tab.setup.rerunAction": "Einrichtung erneut ausführen",
  "settings.tab.setup.action": "Einrichtung starten",

  "settings.advanced.debugMode.name": "Debug-Modus",
  "settings.advanced.debugMode.desc":
    "Details zu Anfragen und Antworten des Plugins protokollieren. API-Schlüssel werden unkenntlich gemacht.",

  "settings.retrieval.heading": "Abruf",
  "settings.retrieval.desc":
    "Steuert, wie Attest vor der Antwort lokale Belege sowie Graph-, Index-, Dokument- und Web-Belege findet.",
  "settings.retrieval.graph.heading": "Obsidian-Graph",
  "settings.retrieval.useLinkedNotes.name": "Verlinkte Notizen verwenden",
  "settings.retrieval.useLinkedNotes.desc":
    "Vor dem Abruf verlinkte Notizen aus @Erwähnungen, aktiven Dateien und eingebundenen Anhängen ermitteln.",
  "settings.retrieval.includeBacklinks.name": "Backlinks einbeziehen",
  "settings.retrieval.includeBacklinks.desc":
    "Backlinks mit einem Schritt Abstand als Graph-Kandidaten nutzen. Backlink-Notizen werden nicht weiter verfolgt.",
  "settings.retrieval.expandFilteredContextThroughLinks.name":
    "Gefilterte Dateien über Links erweitern",
  "settings.retrieval.expandFilteredContextThroughLinks.desc":
    "Wenn angehängte Dateien im Filter-Modus sind, auch deren verlinkte Graph-Nachbarn durchsuchen.",
  "settings.retrieval.graphDepth.name": "Graph-Tiefe",
  "settings.retrieval.graphDepth.desc":
    "Tiefe 1 folgt direkten Links, Einbettungen und Backlinks. Tiefe 2 ist der erweiterten Fehlersuche vorbehalten.",
  "settings.retrieval.search.heading": "Suche",
  "settings.retrieval.expandSearchQuery.name": "Suchanfrage erweitern",
  "settings.retrieval.expandSearchQuery.desc":
    "Vor dem Abruf sprachübergreifende Anfragevarianten erzeugen, damit auch Notizen in anderen Sprachen gefunden werden. Kostet pro Suche einen zusätzlichen Aufruf des Chat-Modells.",
  "settings.retrieval.web.heading": "Web",
  "settings.retrieval.useWebWhenFreshnessNeeded.name": "Web für Aktualitätsfragen nutzen",
  "settings.retrieval.useWebWhenFreshnessNeeded.desc":
    "Web-Belegen mehr Budget geben, wenn eine Frage nach aktuellen Informationen, Neuerscheinungen oder Preisen verlangt.",

  "settings.newChatDefaults.heading": "Vorgaben für neue Chats",
  "settings.newChatDefaults.desc":
    "Startkonfiguration jedes neuen Chats. Gespeicherte Chats behalten ihre eigenen Einstellungen.",
  "settings.newChatDefaults.source.name": "Standardquelle",
  "settings.newChatDefaults.source.desc": "Belegquellen, mit denen ein neuer Chat startet.",
  "settings.newChatDefaults.source.none": "Keine",
  "settings.newChatDefaults.source.indexOnly": "Index",
  "settings.newChatDefaults.source.webOnly": "Web",
  "settings.newChatDefaults.source.indexAndWeb": "Index + Web",
  "settings.newChatDefaults.index.name": "Standardindex",
  "settings.newChatDefaults.index.desc":
    "Indexprofil, mit dem ein neuer Chat startet; wird verwendet, sobald die Quelle den Index einschließt.",
  "settings.newChatDefaults.index.empty": "Keine verfügbaren Indexprofile",
  "settings.newChatDefaults.mode.name": "Standardmodus",
  "settings.newChatDefaults.mode.desc": "Recherchemodus, mit dem ein neuer Chat startet.",
  "settings.newChatDefaults.mode.descBlocked":
    "Recherchemodus, mit dem ein neuer Chat startet. {hint}",
  "settings.newChatDefaults.mode.thinkingUnavailable":
    "Denken benötigt ein Chat-Modell mit bestätigter Agent-Fähigkeit. Zum Aktivieren die Fähigkeiten des Modells testen.",
  "settings.newChatDefaults.mode.instant": "Sofort",
  "settings.newChatDefaults.mode.thinking": "Denken",
  "settings.newChatDefaults.model.name": "Standardmodell",
  "settings.newChatDefaults.model.desc": "Chat-Modell-Profil, mit dem ein neuer Chat startet.",
  "settings.newChatDefaults.model.empty": "Keine verfügbaren Chat-Modell-Profile",
  "settings.newChatDefaults.activeFile.name": "Aktive Datei als Kontext einbeziehen",
  "settings.newChatDefaults.activeFile.desc":
    "Die aktuell geöffnete unterstützte Datei automatisch als expliziten Chat-Kontext einbeziehen.",

  "settings.webSources.heading": "Externe Quellen",
  "settings.webSources.desc":
    "Externe, vom Nutzer ausgelöste Websuche über die aktivierten Quellen. Attest sendet nur die eingegebene Frage, niemals abgerufene Vault-Inhalte.",
  "settings.webSources.count": "{enabled} von {total} aktiviert",
  "settings.webSources.column.source": "Quelle",
  "settings.webSources.column.actions": "Aktionen",
  "settings.webSources.column.state": "Zustand",
  "settings.webSources.categoryCount": "{category} · {enabled}/{total}",
  "settings.webSources.category.serp": "Allgemeine Websuche",
  "settings.webSources.category.neural": "KI-Suche",
  "settings.webSources.category.academic": "Wissenschaft",
  "settings.webSources.category.encyclopedia": "Enzyklopädie",
  "settings.webSources.category.community": "Entwickler & Community",
  "settings.webSources.category.news": "Nachrichten",
  "settings.webSources.category.fetch": "Ausweichabruf von Seiten",
  "settings.webSources.category.image": "Bildersuche",
  "settings.webSources.activation.off": "Aus",
  "settings.webSources.activation.auto": "Auto — wird genutzt, wenn der Planer sie wählt",
  "settings.webSources.activation.always": "Immer — wird bei jeder Websuche abgefragt",
  "settings.webSources.issue.unauthorized": "Zugangsdaten abgelehnt — API-Schlüssel überprüfen",
  "settings.webSources.issue.rateLimited":
    "Ratenlimit überschritten — automatischer erneuter Versuch später",
  "settings.webSources.setUp": "Einrichten…",
  "settings.webSources.setUpAria": "{source} einrichten",
  "settings.webSources.configure": "{source} konfigurieren",
  "settings.webSources.lampIssueTitle": "{issue} — klicken, um zu „{next}“ zu wechseln",
  "settings.webSources.lampTitle": "{source}: {current} — klicken, um zu „{next}“ zu wechseln",
  "settings.webSources.meta.required": "{fields} erforderlich",
  "settings.webSources.meta.configured": "konfiguriert",

  "settings.webSourceModal.title": "{source} konfigurieren",
  "settings.webSourceModal.info": "{note}. ",
  "settings.webSourceModal.providerDocs": "Anbieterdokumentation",
  "settings.webSourceModal.field.optional": "Optional.",
  "settings.webSourceModal.field.required": "Erforderlich, um diese Quelle zu aktivieren.",
  "settings.webSourceModal.imageSearch.name": "Für Bildersuche verwenden",
  "settings.webSourceModal.imageSearch.desc":
    "Standardmäßig aus. Wenn aktiviert, darf search_images den Bild-Endpunkt dieser Engine abfragen, was dasselbe Kontingent wie die Textsuche verbraucht.",
  "settings.webSourceModal.disabledNotice":
    "{source} deaktiviert: erforderliche Zugangsdaten fehlen.",
};
