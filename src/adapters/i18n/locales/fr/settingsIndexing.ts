import type { EnSettingsIndexingMessages } from "../en/settingsIndexing";

export const settingsIndexing: EnSettingsIndexingMessages = {
  "settings.indexing.heading": "Indexation",
  "settings.indexProfiles.title": "Profils d’index",
  "settings.indexProfiles.addAction": "Ajouter un profil d’index",
  "settings.indexProfiles.column.index": "Index",
  "settings.indexProfiles.column.size": "Taille",
  "settings.indexProfiles.column.status": "Statut",
  "settings.indexProfiles.column.actions": "Actions",
  "settings.indexProfiles.mode.wholeVault": "Coffre entier",
  "settings.indexProfiles.mode.selected": "Sélection",
  "settings.indexProfiles.meta": "{mode} · {paths} chemins",
  "settings.indexProfiles.size": "{size} · {files} fichiers",
  "settings.indexProfiles.action.continueIndexing": "Poursuivre l’indexation",
  "settings.indexProfiles.action.pauseIndexing": "Suspendre l’indexation",
  "settings.indexProfiles.action.stopMetadata": "Arrêter l’extraction des métadonnées",
  "settings.indexProfiles.action.updateIndex": "Mettre à jour l’index",
  "settings.indexProfiles.action.startIndexing": "Démarrer l’indexation",
  "settings.indexProfiles.action.showReport": "Afficher le rapport d’index",
  "settings.indexProfiles.action.edit": "Modifier le profil d’index",
  "settings.indexProfiles.action.delete": "Supprimer le profil d’index",
  "settings.indexProfiles.notice.maxProfiles":
    "Il est possible de créer jusqu’à {max} profils d’index.",
  "settings.indexProfiles.notice.embeddingRequired":
    "Créer un modèle d’embeddings actif avant d’ajouter un index.",
  "settings.indexProfiles.notice.embeddingRequiredForRun":
    "Créer un modèle d’embeddings actif avant d’indexer.",
  "settings.indexProfiles.notice.chatRequiredForMetadata":
    "Créer un profil de modèle de chat actif avant d’extraire les métadonnées.",
  "settings.indexProfiles.notice.reportFailed": "Impossible de charger le rapport d’index.",

  "settings.enrichment.running": "Enrichissement{scope}{file}{phase}",
  "settings.enrichment.scope": " {processed}/{total}",
  "settings.enrichment.file": " · {file}",
  "settings.enrichment.phase.metadata": " · extraction des métadonnées",
  "settings.enrichment.phase.sectionsWithCount": " · résumé de la section {index}/{count}",
  "settings.enrichment.phase.sections": " · résumé des sections",
  "settings.enrichment.phase.document": " · rédaction du résumé du document",
  "settings.enrichment.phase.claimsWithCount": " · extraction des assertions {index}/{count}",
  "settings.enrichment.phase.claims": " · extraction des assertions",
  "settings.enrichment.phase.listingSources": " · liste des sources",
  "settings.enrichment.done":
    "Métadonnées : {extracted} extraites, {skipped} à jour{failed} ({total} sources)",
  "settings.enrichment.doneFailed": ", {failed} en échec",
  "settings.enrichment.error": "Échec de l’enrichissement des métadonnées : {message}",
  "settings.enrichment.unknownError": "erreur inconnue",

  "settings.indexStatus.error.label": "Erreur",
  "settings.indexStatus.error.title": "Échec de l’indexation",
  "settings.indexStatus.stale.label": "Index périmé",
  "settings.indexStatus.stale.title":
    "Le profil d’index a changé — lancer Mettre à jour pour rafraîchir l’index.",
  "settings.indexStatus.staleMetadata.label": "Métadonnées périmées",
  "settings.indexStatus.staleMetadata.title":
    "L’index a changé depuis la dernière extraction des métadonnées — lancer Mettre à jour avec la section métadonnées activée.",
  "settings.indexStatus.reindexRequired.label": "Réindexation requise",
  "settings.indexStatus.reindexRequired.title":
    "Cet index a été construit avant l’apparition des métadonnées d’images de documents — le reconstruire entièrement pour activer la découverte d’images par l’index. La recherche textuelle continue de fonctionner.",
  "settings.indexStatus.pausing.label": "Suspension",
  "settings.indexStatus.pausing.tooltip": "Suspension{detail}",
  "settings.indexStatus.indexing.label": "Indexation",
  "settings.indexStatus.indexing.tooltip": "Indexation{detail}",
  "settings.indexStatus.paused.label": "Suspendu",
  "settings.indexStatus.paused.tooltip": "Suspendu{detail}",
  "settings.indexStatus.finished.label": "Terminé",
  "settings.indexStatus.finished.tooltip":
    "Terminé\nFichiers : {scanned} · {counters}\nSegments vectorisés : {chunks}",
  "settings.indexStatus.finished.scanned": "{scanned}/{total} analysés",
  "settings.indexStatus.finished.scanComplete": "analyse terminée",
  "settings.indexStatus.finished.indexed": "{count} indexés",
  "settings.indexStatus.finished.skipped": "{count} ignorés",
  "settings.indexStatus.finished.deferred": "{count} différés",
  "settings.indexStatus.finished.failed": "{count} en échec",
  "settings.indexStatus.stopping.label": "Arrêt",
  "settings.indexStatus.stopping.tooltip": "Arrêt de l’extraction des métadonnées{detail}",
  "settings.indexStatus.enriching.label": "Enrichissement",
  "settings.indexStatus.enriching.tooltip": "Enrichissement des métadonnées{detail}",
  "settings.indexStatus.progress.chunks": " · {embedded}/{total} segments{file}",
  "settings.indexStatus.progress.files": " · {percent} % · {scanned}/{total} fichiers{file}",
  "settings.indexStatus.progress.file": " · {file}",
  "settings.indexStatus.enrichmentDetail": "{scope}{file}{phase}",
  "settings.indexStatus.enrichmentScope": " · {processed}/{total}",
  "settings.indexStatus.enrichmentPhase.metadata": "\nextraction des métadonnées",
  "settings.indexStatus.enrichmentPhase.sectionsWithCount":
    "\nrésumé de la section {index}/{count}",
  "settings.indexStatus.enrichmentPhase.sections": "\nrésumé des sections",
  "settings.indexStatus.enrichmentPhase.document": "\nrédaction du résumé du document",
  "settings.indexStatus.enrichmentPhase.listingSources": "\nliste des sources",

  "settings.indexProfileModal.editTitle": "Modifier le profil d’index",
  "settings.indexProfileModal.addTitle": "Ajouter un profil d’index",
  "settings.indexProfileModal.name.name": "Nom",
  "settings.indexProfileModal.name.desc":
    "Nom d’index unique affiché dans les paramètres, le chat et les sélecteurs de recherche. {max} caractères maximum.",
  "settings.indexProfileModal.mode.name": "Mode",
  "settings.indexProfileModal.mode.desc":
    "Coffre entier indexe tous les fichiers visibles pris en charge, sauf les chemins exclus ; Sélection n’indexe que les chemins choisis.",
  "settings.indexProfileModal.mode.wholeVault": "Coffre entier",
  "settings.indexProfileModal.mode.selected": "Sélection",
  "settings.indexProfileModal.included.name": "Inclus",
  "settings.indexProfileModal.included.desc": "Fichiers et dossiers à inclure dans cet index.",
  "settings.indexProfileModal.excluded.name": "Exclus",
  "settings.indexProfileModal.excluded.desc":
    "Fichiers et dossiers à exclure de cet index du coffre entier.",
  "settings.indexProfileModal.embeddingModel.name": "Modèle d’embeddings",
  "settings.indexProfileModal.embeddingModel.desc":
    "Modèle d’embeddings utilisé pour générer les vecteurs de cet index.",
  "settings.indexProfileModal.embeddingModel.placeholder": "Sélectionner un modèle d’embeddings",
  "settings.indexProfileModal.chunkSize.name": "Taille de segment",
  "settings.indexProfileModal.chunkSize.desc":
    "Taille maximale d’un segment de texte pour les fichiers non PDF.",
  "settings.indexProfileModal.chunkOverlap.name": "Chevauchement des segments",
  "settings.indexProfileModal.chunkOverlap.desc":
    "Nombre de caractères partagés entre deux segments non PDF adjacents.",
  "settings.indexProfileModal.embeddingBatchSize.name": "Taille de lot d’embeddings",
  "settings.indexProfileModal.embeddingBatchSize.desc":
    "Nombre de segments envoyés dans une même requête d’embeddings.",
  "settings.indexProfileModal.pdfChunkSize.name": "Taille de segment PDF",
  "settings.indexProfileModal.pdfChunkSize.desc":
    "Taille maximale d’un segment de texte pour les fichiers PDF.",
  "settings.indexProfileModal.pdfChunkOverlap.name": "Chevauchement des segments PDF",
  "settings.indexProfileModal.pdfChunkOverlap.desc":
    "Nombre de caractères partagés entre deux segments PDF adjacents.",
  "settings.indexProfileModal.choose": "Choisir",
  "settings.indexProfileModal.noPaths": "Aucun chemin sélectionné",
  "settings.indexProfileModal.error.name":
    "Utiliser un nom unique d’au plus 60 caractères composé de lettres, chiffres, espaces, _, -, ., (, ), [, ].",
  "settings.indexProfileModal.error.embeddingModel": "Sélectionner un modèle d’embeddings.",
  "settings.indexProfileModal.error.includedPath": "Sélectionner au moins un chemin inclus.",
  "settings.indexProfileModal.error.numbers":
    "Les paramètres numériques de l’index doivent être des entiers valides.",
  "settings.indexProfileModal.notice.rebuild":
    "Les paramètres de l’index ont changé. Reconstruire cet index pour appliquer la nouvelle configuration.",

  "settings.indexPathPicker.title": "Choisir des fichiers et des dossiers",
  "settings.indexPathPicker.search.name": "Rechercher",
  "settings.indexPathPicker.search.placeholder": "Filtrer les fichiers et les dossiers",
  "settings.indexPathPicker.empty": "Aucun chemin correspondant",
  "settings.indexPathPicker.toggle": "Basculer {path}",
  "settings.indexPathPicker.vaultRoot": "racine du coffre",
  "settings.indexPathPicker.select": "Sélectionner {path}",

  "settings.indexRun.updateTitle": "Mettre à jour « {profile} »",
  "settings.indexRun.indexTitle": "Indexer « {profile} »",
  "settings.indexRun.embedding.name": "Indexer le contenu (modèle d’embeddings)",
  "settings.indexRun.embedding.desc":
    "Extraire, segmenter et vectoriser les fichiers du coffre dans l’index.",
  "settings.indexRun.embeddingModel.name": "Modèle d’embeddings",
  "settings.indexRun.modelOption": "{name} ({model})",
  "settings.indexRun.tokenWarning":
    "L’extraction des métadonnées peut être longue et consommer un grand nombre de tokens.",
  "settings.indexRun.metadata.name": "Extraire métadonnées et résumés (modèle de chat)",
  "settings.indexRun.metadata.desc":
    "Extraire le titre, les auteurs, l’année, le résumé et les références, et générer des résumés de section et de document pour chaque document. Les documents inchangés sont ignorés.",
  "settings.indexRun.metadataModel.name": "Modèle pour les métadonnées",
  "settings.indexRun.reextract.name": "Réextraire les documents inchangés",
  "settings.indexRun.reextract.desc":
    "Ignorer les métadonnées stockées et relancer l’extraction pour chaque document.",
  "settings.indexRun.embeddingChangedWarning":
    "Changer de modèle d’embeddings impose une réindexation complète : lancer cette opération reconstruira l’index (et ses métadonnées) depuis zéro.",
  "settings.indexRun.start": "Démarrer",
  "settings.indexRun.rebuild": "Reconstruire",
  "settings.indexRun.update": "Mettre à jour",

  "settings.indexReport.title": "Rapport de {profile}",
  "settings.indexReport.indexedFiles": "{count} fichiers indexés",
  "settings.indexReport.failedFiles": "{count} fichiers en échec",
  "settings.indexReport.chunks": "{count} segments",
  "settings.indexReport.enriched": "{count} enrichis",
  "settings.indexReport.empty": "Aucun rapport d’indexation n’est encore disponible.",
  "settings.indexReport.failed": "Échec",
  "settings.indexReport.indexingFailed": "Échec de l’indexation.",
  "settings.indexReport.metadataSection": "Métadonnées de l’index",
  "settings.indexReport.extractionModel": "Modèle d’extraction : {models}",
  "settings.indexReport.lastExtracted": "Dernière extraction : {timestamp}",
  "settings.indexReport.referencesCollected": "Références collectées : {count}",
  "settings.indexReport.sharedReferences": "Références communes (citées par plusieurs documents) :",
  "settings.indexReport.sharedReference": "{count}× — {reference}",
  "settings.indexReport.citedBy": "Cité par : {sources}",
  "settings.indexReport.authors": "Auteurs : {authors}",
  "settings.indexReport.references": "Références ({count}) :",
  "settings.indexReport.summary": "Résumé · {count} sections",
  "settings.indexReport.section": "{heading} : {summary}",
  "settings.indexReport.metadataFallbackTitle": "Métadonnées",
  "settings.indexReport.refs": "{count} réf.",
};
