import type { EnOnboardingMessages } from "../en/onboarding";

export const onboarding: EnOnboardingMessages = {
  "onboarding.title": "Attest einrichten",
  "onboarding.progress": "Schritt {step} von {total}",
  "onboarding.scope.pickOne": "Wähle eine Option, um fortzufahren",

  "onboarding.action.back": "Zurück",
  "onboarding.action.skip": "Überspringen und manuell einrichten",
  "onboarding.action.continue": "Weiter",
  "onboarding.action.checking": "Wird geprüft…",
  "onboarding.action.startIndexing": "Indizierung starten",
  "onboarding.action.finish": "Fertigstellen",
  "onboarding.action.openChat": "Chat öffnen",
  "onboarding.action.addVaultLater": "Notizsuche später hinzufügen",
  "onboarding.action.keepIndexing": "Im Hintergrund weiter indizieren",

  "onboarding.chat.title": "Chat-Anbieter und Modell",
  "onboarding.chat.intro":
    "Attest legt die Profile unterwegs für dich an. Alles hier lässt sich später in den Plugin-Einstellungen ändern.",

  "onboarding.endpoint.provider.name": "Anbieter",
  "onboarding.endpoint.provider.chatDesc":
    "Füllt Basis-URL und API-Format aus. Dein Einbettungsmodell darf ein anderes verwenden.",
  "onboarding.endpoint.provider.embeddingDesc":
    "Das Einbettungsmodell kann auf einem anderen Server liegen als das Chat-Modell.",
  "onboarding.endpoint.baseUrl.name": "Basis-URL",
  "onboarding.endpoint.baseUrl.desc":
    "Wird vom Anbieter ausgefüllt. Passe sie für einen selbst gehosteten Endpunkt an.",
  "onboarding.endpoint.apiKey.name": "API-Schlüssel (optional)",
  "onboarding.endpoint.apiKey.desc":
    "Wird in den Plugin-Einstellungen dieses Tresors gespeichert. Lokale Anbieter brauchen keinen.",
  "onboarding.endpoint.connection.name": "Verbindung",
  "onboarding.endpoint.connection.action": "Verbindung testen",
  "onboarding.endpoint.connection.desc":
    "Lade die Modellliste, um zu bestätigen, dass der Endpunkt antwortet.",
  "onboarding.endpoint.connection.testing": "Anbieter wird kontaktiert…",
  "onboarding.endpoint.connection.mobileLocal":
    "Lokale Modellanbieter sind auf Obsidian Mobile nicht verfügbar. Wähle einen Cloud-Anbieter.",
  "onboarding.endpoint.model.chatName": "Chat-Modell",
  "onboarding.endpoint.model.embeddingName": "Einbettungsmodell",
  "onboarding.endpoint.model.desc": "{count} Modelle passen zu dieser Rolle.",
  "onboarding.endpoint.model.empty": "Teste die Verbindung, um die Modellliste zu laden.",
  "onboarding.endpoint.model.placeholder": "Modell auswählen",
  "onboarding.endpoint.model.testing": "Test läuft",

  "onboarding.scope.title": "Woher sollen die Antworten kommen?",
  "onboarding.scope.intro":
    "Das ist die einzige Entscheidung, die den restlichen Einrichtungsaufwand verändert. Die Suche im Tresor braucht ein Einbettungsmodell und einen Index; das Web braucht beides nicht.",
  "onboarding.scope.notesAndWeb.name": "Meine Notizen und das Web",
  "onboarding.scope.notesAndWeb.desc":
    "Der volle Umfang. Noch zwei Schritte: ein Einbettungsmodell, dann die zu indizierenden Ordner.",
  "onboarding.scope.webOnly.name": "Nur das Web",
  "onboarding.scope.webOnly.desc":
    "Belegte Antworten aus dem offenen Web, dazu die gerade geöffnete Notiz. Kein Index und kein Einbettungsmodell. DuckDuckGo ist bereits aktiv und braucht keinen Schlüssel.",
  "onboarding.scope.notesOnly.name": "Nur meine Notizen",
  "onboarding.scope.notesOnly.desc":
    "Außer der Frage selbst, die an dein Chat-Modell geht, verlässt nichts den Tresor.",
  "onboarding.scope.remaining.two": "Noch 2 Schritte",
  "onboarding.scope.remaining.none": "Danach ist alles fertig",

  "onboarding.embedding.title": "Das Modell, das deine Notizen liest",
  "onboarding.embedding.intro":
    "Es darf von einem anderen Anbieter stammen als dein Chat-Modell — üblich ist ein Chat-Modell in der Cloud mit lokalen Einbettungen, damit der Notiztext den Rechner nie verlässt.",
  "onboarding.embedding.sameAsChat.name": "Derselbe Server wie beim Chat-Modell",
  "onboarding.embedding.previousProvider": "zuvor: Wie im Chat ({provider})",
  "onboarding.embedding.sameAsChat.desc":
    "Schalte dies aus, um an einem anderen Endpunkt einzubetten. Dann wird ein zweites Serverprofil angelegt.",
  "onboarding.embedding.rebuildWarning":
    "Wird dieses Modell später gewechselt, muss der Index neu gebaut werden: Vektoren aus zwei Modellen sind nicht vergleichbar.",
  "onboarding.embedding.unverified":
    "Die Einbettungsfähigkeit ließ sich nicht bestätigen. Dein Chat-Modell funktioniert bereits, du kannst also mit dem Web abschließen und die Tresorsuche später ergänzen.",
  "onboarding.embedding.useWebInstead": "Stattdessen das Web nutzen",

  "onboarding.folders.title": "Welche Notizen darf Attest lesen?",
  "onboarding.folders.intro":
    "Nur diese Ordner werden indiziert, und nur sie können zitiert werden.",
  "onboarding.folders.mode.name": "Ordner",
  "onboarding.folders.mode.desc":
    "Fang eng an — später zu erweitern ist eine günstige inkrementelle Aktualisierung.",
  "onboarding.folders.mode.wholeVault": "Ganzer Tresor",
  "onboarding.folders.mode.selected": "Ausgewählte Ordner",
  "onboarding.folders.paths.name": "Ausgewählt",
  "onboarding.folders.paths.action": "Ordner wählen…",
  "onboarding.folders.paths.empty": "Noch nichts ausgewählt.",
  "onboarding.folders.paths.remove": "{path} entfernen",
  "onboarding.folders.excluded.name": "Ausgeschlossen",
  "onboarding.folders.excluded.desc": "Vorausgefüllt.",
  "onboarding.folders.location.name": "Indexspeicherort",
  "onboarding.folders.location.desc":
    "Im Vault, damit der Index mit deinen Notizen synchronisiert wird.",
  "onboarding.folders.location.outsideVault":
    "Der Index muss im Tresor bleiben. Entfernen Sie „..“-Segmente und den führenden Schrägstrich.",
  "onboarding.folders.mobileWarning":
    "Auf Mobilgeräten ist der erste Aufbau langsam: kleine Stapel, jeweils eine PDF-Seite, große PDFs werden übersprungen. Baue den Index am Desktop und synchronisiere ihn, oder nimm vorerst den Weg nur über das Web.",

  "onboarding.finish.web.title": "Web-Recherche ist bereit",
  "onboarding.finish.web.status": "2 Profile · keine Wartezeit",
  "onboarding.finish.vault.title": "Notizsuche wird indiziert",
  "onboarding.finish.vault.status": "läuft im Hintergrund",
  "onboarding.finish.vault.doneTitle": "Notizsuche ist bereit",
  "onboarding.finish.vault.doneStatus": "Indizierung abgeschlossen",
  "onboarding.finish.vault.errorTitle": "Indizierung abgebrochen",
  "onboarding.finish.vault.errorStatus": "Indizierung fehlgeschlagen",
  "onboarding.finish.tag.server": "Serverprofil",
  "onboarding.finish.tag.chat": "Chat-Modell",
  "onboarding.finish.tag.embedding": "Embedding-Modell",
  "onboarding.finish.tag.index": "Indexprofil",
  "onboarding.finish.stats.files": "{scanned} / {total} Dateien",
  "onboarding.finish.stats.chunks": "{embedded} / {total} Abschnitte",
  "onboarding.finish.webIntro":
    "Es gibt nichts zu indizieren, damit endet die Einrichtung hier. Stelle eine Frage, und die Antwort belegt die verwendeten Webseiten.",
  "onboarding.finish.vaultIntro":
    "Der Chat öffnet sich jetzt; Antworten aus dem Tresor werden besser, sobald Abschnitte eintreffen. Der Index wird weiter aufgebaut, auch wenn du diesen Dialog schließt.",
  "onboarding.finish.vaultDoneIntro":
    "Alle ausgewählten Notizen sind indiziert. Stellen Sie eine Frage, und die Antwort zitiert die verwendeten Notizen.",
  "onboarding.finish.vaultErrorIntro":
    "Das Chat-Modell funktioniert, Sie können sofort loslegen. Öffnen Sie das Indexprofil in den Einstellungen, um die Ursache zu sehen und den Lauf zu wiederholen.",
  "onboarding.finish.indexingStarting": "Erster Indexaufbau wird gestartet…",

  "command.runSetup": "Ersteinrichtung ausführen",
};
