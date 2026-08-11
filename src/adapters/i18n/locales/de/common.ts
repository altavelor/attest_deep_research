import type { EnCommonMessages } from "../en/common";

export const common: EnCommonMessages = {
  "common.cancel": "Abbrechen",
  "common.save": "Speichern",
  "common.close": "Schließen",
  "common.advanced": "Erweitert",
  "common.unknownError": "Unbekannter Fehler",
  "common.copiedToClipboard": "In die Zwischenablage kopiert.",
  "common.pdfPage": "S. {page}",

  "profile.error.chatModelMissing": "Vor einer Frage ein Chat-Modell-Profil auswählen.",
  "profile.error.embeddingModelMissing":
    "Vor der Nutzung dieses Index ein Embedding-Modell-Profil auswählen.",
  "profile.error.serverUnavailable": "Das ausgewählte Serverprofil ist nicht verfügbar.",
  "profile.error.indexNotBuilt":
    "Dieses Profil indizieren, bevor es in Chat oder Suche verwendet wird.",
  "profile.error.indexUnavailable": "Das ausgewählte Indexprofil ist nicht verfügbar.",
  "profile.warning.indexNotSelected":
    "Vor der Suche ein indiziertes Profil in den Attest-Einstellungen auswählen.",
  "profile.warning.embeddingProfileUnavailable":
    "Das Embedding-Modell-Profil des ausgewählten Index ist nicht verfügbar. In den Attest-Einstellungen aktualisieren.",
  "profile.warning.embeddingProfileSuspended":
    "Das Embedding-Modell-Profil des ausgewählten Index ist ausgesetzt. In den Attest-Einstellungen aktualisieren.",
  "profile.warning.embeddingNotSupported":
    "Das Embedding-Modell des ausgewählten Index kann keine Embeddings erzeugen. In den Attest-Einstellungen aktualisieren.",
  "profile.warning.embeddingServerUnavailable":
    "Der Embedding-Server des ausgewählten Index ist nicht verfügbar. In den Attest-Einstellungen aktualisieren.",
};
