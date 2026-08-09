import type { EnSettingsIndexingMessages } from "../en/settingsIndexing";

export const settingsIndexing: EnSettingsIndexingMessages = {
  "settings.indexing.heading": "Indizierung",
  "settings.indexProfiles.title": "Indexprofile",
  "settings.indexProfiles.addAction": "Indexprofil hinzufügen",
  "settings.indexProfiles.column.index": "Index",
  "settings.indexProfiles.column.size": "Größe",
  "settings.indexProfiles.column.status": "Status",
  "settings.indexProfiles.column.actions": "Aktionen",
  "settings.indexProfiles.mode.wholeVault": "Gesamter Vault",
  "settings.indexProfiles.mode.selected": "Ausgewählt",
  "settings.indexProfiles.meta": "{mode} · {paths} Pfade",
  "settings.indexProfiles.size": "{size} · {files} Dateien",
  "settings.indexProfiles.action.continueIndexing": "Indizierung fortsetzen",
  "settings.indexProfiles.action.pauseIndexing": "Indizierung pausieren",
  "settings.indexProfiles.action.stopMetadata": "Metadaten-Extraktion stoppen",
  "settings.indexProfiles.action.updateIndex": "Index aktualisieren",
  "settings.indexProfiles.action.startIndexing": "Indizierung starten",
  "settings.indexProfiles.action.showReport": "Indexbericht anzeigen",
  "settings.indexProfiles.action.edit": "Indexprofil bearbeiten",
  "settings.indexProfiles.action.delete": "Indexprofil löschen",
  "settings.indexProfiles.notice.maxProfiles": "Es lassen sich bis zu {max} Indexprofile anlegen.",
  "settings.indexProfiles.notice.embeddingRequired":
    "Vor dem Hinzufügen eines Index ein aktives Embedding-Modell anlegen.",
  "settings.indexProfiles.notice.embeddingRequiredForRun":
    "Vor der Indizierung ein aktives Embedding-Modell anlegen.",
  "settings.indexProfiles.notice.chatRequiredForMetadata":
    "Vor der Metadaten-Extraktion ein aktives Chat-Modell-Profil anlegen.",
  "settings.indexProfiles.notice.reportFailed": "Indexbericht konnte nicht geladen werden.",

  "settings.enrichment.running": "Anreicherung{scope}{file}{phase}",
  "settings.enrichment.scope": " {processed}/{total}",
  "settings.enrichment.file": " · {file}",
  "settings.enrichment.phase.metadata": " · Metadaten werden extrahiert",
  "settings.enrichment.phase.sectionsWithCount":
    " · Abschnitt {index}/{count} wird zusammengefasst",
  "settings.enrichment.phase.sections": " · Abschnitte werden zusammengefasst",
  "settings.enrichment.phase.document": " · Dokument-Zusammenfassung wird geschrieben",
  "settings.enrichment.phase.claimsWithCount": " · Aussagen {index}/{count} werden extrahiert",
  "settings.enrichment.phase.claims": " · Aussagen werden extrahiert",
  "settings.enrichment.phase.listingSources": " · Quellen werden aufgelistet",
  "settings.enrichment.done":
    "Metadaten: {extracted} extrahiert, {skipped} aktuell{failed} ({total} Quellen)",
  "settings.enrichment.doneFailed": ", {failed} fehlgeschlagen",
  "settings.enrichment.error": "Metadaten-Anreicherung fehlgeschlagen: {message}",
  "settings.enrichment.unknownError": "unbekannter Fehler",

  "settings.indexStatus.error.label": "Fehler",
  "settings.indexStatus.error.title": "Indizierung fehlgeschlagen",
  "settings.indexStatus.stale.label": "Veralteter Index",
  "settings.indexStatus.stale.title":
    "Das Indexprofil hat sich geändert — Aktualisieren ausführen, um den Index zu erneuern.",
  "settings.indexStatus.staleMetadata.label": "Veraltete Metadaten",
  "settings.indexStatus.staleMetadata.title":
    "Der Index hat sich nach der letzten Metadaten-Extraktion geändert — Aktualisieren mit aktiviertem Metadaten-Abschnitt ausführen.",
  "settings.indexStatus.reindexRequired.label": "Neuindizierung nötig",
  "settings.indexStatus.reindexRequired.title":
    "Dieser Index entstand, bevor es Metadaten zu Dokumentbildern gab — einen vollständigen Neuaufbau ausführen, um die indexbasierte Bildsuche zu aktivieren. Die Textsuche funktioniert weiterhin.",
  "settings.indexStatus.pausing.label": "Wird pausiert",
  "settings.indexStatus.pausing.tooltip": "Wird pausiert{detail}",
  "settings.indexStatus.indexing.label": "Indizierung",
  "settings.indexStatus.indexing.tooltip": "Indizierung{detail}",
  "settings.indexStatus.paused.label": "Pausiert",
  "settings.indexStatus.paused.tooltip": "Pausiert{detail}",
  "settings.indexStatus.finished.label": "Abgeschlossen",
  "settings.indexStatus.finished.tooltip":
    "Abgeschlossen\nDateien: {scanned} · {counters}\nEingebettete Chunks: {chunks}",
  "settings.indexStatus.finished.scanned": "{scanned}/{total} geprüft",
  "settings.indexStatus.finished.scanComplete": "Prüfung abgeschlossen",
  "settings.indexStatus.finished.indexed": "{count} indiziert",
  "settings.indexStatus.finished.skipped": "{count} übersprungen",
  "settings.indexStatus.finished.deferred": "{count} zurückgestellt",
  "settings.indexStatus.finished.failed": "{count} fehlgeschlagen",
  "settings.indexStatus.stopping.label": "Wird gestoppt",
  "settings.indexStatus.stopping.tooltip": "Metadaten-Extraktion wird gestoppt{detail}",
  "settings.indexStatus.enriching.label": "Anreicherung",
  "settings.indexStatus.enriching.tooltip": "Metadaten werden angereichert{detail}",
  "settings.indexStatus.progress.chunks": " · {embedded}/{total} Chunks{file}",
  "settings.indexStatus.progress.files": " · {percent} % · {scanned}/{total} Dateien{file}",
  "settings.indexStatus.progress.file": " · {file}",
  "settings.indexStatus.enrichmentDetail": "{scope}{file}{phase}",
  "settings.indexStatus.enrichmentScope": " · {processed}/{total}",
  "settings.indexStatus.enrichmentPhase.metadata": "\nMetadaten werden extrahiert",
  "settings.indexStatus.enrichmentPhase.sectionsWithCount":
    "\nAbschnitt {index}/{count} wird zusammengefasst",
  "settings.indexStatus.enrichmentPhase.sections": "\nAbschnitte werden zusammengefasst",
  "settings.indexStatus.enrichmentPhase.document": "\nDokument-Zusammenfassung wird geschrieben",
  "settings.indexStatus.enrichmentPhase.listingSources": "\nQuellen werden aufgelistet",

  "settings.indexProfileModal.editTitle": "Indexprofil bearbeiten",
  "settings.indexProfileModal.addTitle": "Indexprofil hinzufügen",
  "settings.indexProfileModal.name.name": "Name",
  "settings.indexProfileModal.name.desc":
    "Eindeutiger Indexname, der in Einstellungen, Chat und Suchauswahl angezeigt wird. Maximal {max} Zeichen.",
  "settings.indexProfileModal.mode.name": "Modus",
  "settings.indexProfileModal.mode.desc":
    "Gesamter Vault indiziert jede unterstützte sichtbare Datei außer ausgeschlossenen Pfaden; Ausgewählt indiziert nur die gewählten Pfade.",
  "settings.indexProfileModal.mode.wholeVault": "Gesamter Vault",
  "settings.indexProfileModal.mode.selected": "Ausgewählt",
  "settings.indexProfileModal.included.name": "Eingeschlossen",
  "settings.indexProfileModal.included.desc":
    "Dateien und Ordner, die in diesen Index aufgenommen werden sollen.",
  "settings.indexProfileModal.excluded.name": "Ausgeschlossen",
  "settings.indexProfileModal.excluded.desc":
    "Dateien und Ordner, die aus diesem Index über den gesamten Vault ausgeschlossen werden sollen.",
  "settings.indexProfileModal.embeddingModel.name": "Embedding-Modell",
  "settings.indexProfileModal.embeddingModel.desc":
    "Embedding-Modell, das die Vektoren für diesen Index erzeugt.",
  "settings.indexProfileModal.embeddingModel.placeholder": "Embedding-Modell auswählen",
  "settings.indexProfileModal.chunkSize.name": "Chunk-Größe",
  "settings.indexProfileModal.chunkSize.desc": "Maximale Textchunk-Größe für Dateien außer PDF.",
  "settings.indexProfileModal.chunkOverlap.name": "Chunk-Überlappung",
  "settings.indexProfileModal.chunkOverlap.desc":
    "Anzahl der Zeichen, die benachbarte Chunks außerhalb von PDF teilen.",
  "settings.indexProfileModal.embeddingBatchSize.name": "Embedding-Stapelgröße",
  "settings.indexProfileModal.embeddingBatchSize.desc":
    "Anzahl der Chunks, die in einer Embedding-Anfrage gesendet werden.",
  "settings.indexProfileModal.pdfChunkSize.name": "PDF-Chunk-Größe",
  "settings.indexProfileModal.pdfChunkSize.desc": "Maximale Textchunk-Größe für PDF-Dateien.",
  "settings.indexProfileModal.pdfChunkOverlap.name": "PDF-Chunk-Überlappung",
  "settings.indexProfileModal.pdfChunkOverlap.desc":
    "Anzahl der Zeichen, die benachbarte PDF-Chunks teilen.",
  "settings.indexProfileModal.choose": "Auswählen",
  "settings.indexProfileModal.noPaths": "Keine Pfade ausgewählt",
  "settings.indexProfileModal.error.name":
    "Einen eindeutigen Namen mit bis zu 60 Zeichen aus Buchstaben, Ziffern, Leerzeichen, _, -, ., (, ), [, ] verwenden.",
  "settings.indexProfileModal.error.embeddingModel": "Ein Embedding-Modell auswählen.",
  "settings.indexProfileModal.error.includedPath":
    "Mindestens einen eingeschlossenen Pfad auswählen.",
  "settings.indexProfileModal.error.numbers":
    "Numerische Index-Einstellungen müssen gültige ganze Zahlen sein.",
  "settings.indexProfileModal.notice.rebuild":
    "Index-Einstellungen geändert. Diesen Index neu aufbauen, um die neue Konfiguration zu übernehmen.",

  "settings.indexPathPicker.title": "Dateien und Ordner auswählen",
  "settings.indexPathPicker.search.name": "Suche",
  "settings.indexPathPicker.search.placeholder": "Dateien und Ordner filtern",
  "settings.indexPathPicker.empty": "Keine passenden Pfade",
  "settings.indexPathPicker.toggle": "{path} umschalten",
  "settings.indexPathPicker.vaultRoot": "Vault-Wurzel",
  "settings.indexPathPicker.select": "{path} auswählen",

  "settings.indexRun.updateTitle": "„{profile}“ aktualisieren",
  "settings.indexRun.indexTitle": "„{profile}“ indizieren",
  "settings.indexRun.embedding.name": "Inhalte indizieren (Embedding-Modell)",
  "settings.indexRun.embedding.desc":
    "Vault-Dateien extrahieren, in Chunks teilen und in den Index einbetten.",
  "settings.indexRun.embeddingModel.name": "Embedding-Modell",
  "settings.indexRun.modelOption": "{name} ({model})",
  "settings.indexRun.tokenWarning":
    "Die Metadaten-Extraktion kann lange dauern und sehr viele Token verbrauchen.",
  "settings.indexRun.metadata.name": "Metadaten & Zusammenfassungen extrahieren (Chat-Modell)",
  "settings.indexRun.metadata.desc":
    "Titel, Autoren, Jahr, Abstract und Literaturangaben extrahieren sowie Abschnitts- und Dokument-Zusammenfassungen für jedes Dokument erzeugen. Unveränderte Dokumente werden übersprungen.",
  "settings.indexRun.metadataModel.name": "Metadaten-Modell",
  "settings.indexRun.reextract.name": "Unveränderte Dokumente erneut extrahieren",
  "settings.indexRun.reextract.desc":
    "Gespeicherte Metadaten ignorieren und die Extraktion für jedes Dokument erneut ausführen.",
  "settings.indexRun.embeddingChangedWarning":
    "Ein Wechsel des Embedding-Modells erfordert eine vollständige Neuindizierung: dieser Lauf baut den Index (und seine Metadaten) von Grund auf neu auf.",
  "settings.indexRun.start": "Starten",
  "settings.indexRun.rebuild": "Neu aufbauen",
  "settings.indexRun.update": "Aktualisieren",

  "settings.indexReport.title": "Bericht zu {profile}",
  "settings.indexReport.indexedFiles": "{count} indizierte Dateien",
  "settings.indexReport.failedFiles": "{count} fehlgeschlagene Dateien",
  "settings.indexReport.chunks": "{count} Chunks",
  "settings.indexReport.enriched": "{count} angereichert",
  "settings.indexReport.empty": "Es liegt noch kein Indizierungsbericht vor.",
  "settings.indexReport.failed": "Fehlgeschlagen",
  "settings.indexReport.indexingFailed": "Indizierung fehlgeschlagen.",
  "settings.indexReport.metadataSection": "Index-Metadaten",
  "settings.indexReport.extractionModel": "Extraktionsmodell: {models}",
  "settings.indexReport.lastExtracted": "Zuletzt extrahiert: {timestamp}",
  "settings.indexReport.referencesCollected": "Gesammelte Literaturangaben: {count}",
  "settings.indexReport.sharedReferences":
    "Gemeinsame Literaturangaben (von mehreren Dokumenten zitiert):",
  "settings.indexReport.sharedReference": "{count}× — {reference}",
  "settings.indexReport.citedBy": "Zitiert von: {sources}",
  "settings.indexReport.authors": "Autoren: {authors}",
  "settings.indexReport.references": "Literaturangaben ({count}):",
  "settings.indexReport.summary": "Zusammenfassung · {count} Abschnitte",
  "settings.indexReport.section": "{heading}: {summary}",
  "settings.indexReport.metadataFallbackTitle": "Metadaten",
  "settings.indexReport.refs": "{count} Angaben",
};
