import type { EnCommonMessages } from "../en/common";

export const common: EnCommonMessages = {
  "common.cancel": "Annuler",
  "common.save": "Enregistrer",
  "common.close": "Fermer",
  "common.advanced": "Avancé",
  "common.unknownError": "Erreur inconnue",
  "common.copiedToClipboard": "Copié dans le presse-papiers.",
  "common.pdfPage": "p. {page}",

  "profile.error.chatModelMissing":
    "Sélectionner un profil de modèle de chat avant de poser une question.",
  "profile.error.embeddingModelMissing":
    "Sélectionner un profil de modèle d’embeddings avant d’utiliser cet index.",
  "profile.error.serverUnavailable": "Le profil de serveur sélectionné est indisponible.",
  "profile.error.indexNotBuilt":
    "Indexer ce profil avant de l’utiliser dans le chat ou la recherche.",
  "profile.error.indexUnavailable": "Le profil d’index sélectionné est indisponible.",
  "profile.warning.indexNotSelected":
    "Sélectionner un profil indexé dans les paramètres Ixplorer avant de lancer une recherche.",
  "profile.warning.embeddingProfileUnavailable":
    "Le profil de modèle d’embeddings de l’index sélectionné est indisponible. Le mettre à jour dans les paramètres Ixplorer.",
  "profile.warning.embeddingProfileSuspended":
    "Le profil de modèle d’embeddings de l’index sélectionné est suspendu. Le mettre à jour dans les paramètres Ixplorer.",
  "profile.warning.embeddingNotSupported":
    "Le modèle d’embeddings de l’index sélectionné ne peut pas créer d’embeddings. Le mettre à jour dans les paramètres Ixplorer.",
  "profile.warning.embeddingServerUnavailable":
    "Le serveur d’embeddings de l’index sélectionné est indisponible. Le mettre à jour dans les paramètres Ixplorer.",
};
