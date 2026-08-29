import type { EnSettingsProfilesMessages } from "../en/settingsProfiles";

export const settingsProfiles: EnSettingsProfilesMessages = {
  "settings.status.suspended": "Suspendu",

  "settings.profileList.addAction": "Ajouter {title}",
  "settings.profileList.column.profile": "Profil",
  "settings.profileList.column.status": "Statut",
  "settings.profileList.column.actions": "Actions",
  "settings.profileList.editAction": "Modifier le profil",
  "settings.profileList.tag.agent": "Agent",
  "settings.profileList.tag.tools": "Outils",
  "settings.profileList.tag.instant": "Instantané",

  "settings.capability.status": "{tools} · {agent}",
  "settings.capability.entry": "{subject} : {phase}",
  "settings.capability.subject.tools": "Prise en charge des outils",
  "settings.capability.subject.agent": "Prise en charge du mode agent",
  "settings.capability.phase.testing": "Test en cours…",
  "settings.capability.phase.verified": "Vérifiée",
  "settings.capability.phase.advertised": "Annoncé par le fournisseur",
  "settings.capability.phase.notVerified": "Non vérifiée",
  "settings.capability.phase.failed": "Échec",
  "settings.capability.phase.notTested": "Non testée",

  "settings.models.heading": "Profils de modèles",
  "settings.models.desc":
    "Configurer les points d’accès des fournisseurs ainsi que les modèles de chat ou d’embeddings qui les utilisent.",
  "settings.models.server.title": "Profils de serveur",
  "settings.models.server.deleteTooltip": "Supprimer le profil de serveur",
  "settings.models.server.deleteBlockedTooltip":
    "Supprimer d’abord les profils de modèle dépendants",
  "settings.models.server.deleteBlockedNotice":
    "Supprimer d’abord les profils de modèle dépendants.",
  "settings.models.chat.title": "Profils de modèle de chat",
  "settings.models.chat.deleteTooltip": "Supprimer le profil de modèle de chat",
  "settings.models.chat.testingLabel": "Test des capacités…",
  "settings.models.chat.testingNotice": "Test des capacités de {profile}.",
  "settings.models.embedding.title": "Profils de modèle d’embeddings",
  "settings.models.embedding.deleteTooltip": "Supprimer le profil de modèle d’embeddings",
  "settings.models.embedding.deleteBlockedTooltip":
    "Ce modèle d’embeddings est utilisé par un profil d’index",
  "settings.models.embedding.deleteBlockedNotice":
    "Ce modèle d’embeddings est utilisé par un profil d’index.",
  "settings.models.embedding.defaultBadge": "Par défaut",
  "settings.models.embedding.defaultBadgeTitle": "Modèle d’embeddings par défaut",
  "settings.models.embedding.defaultAction": "Modèle par défaut",
  "settings.models.embedding.setDefaultAction": "Définir comme modèle par défaut",

  "settings.prober.capabilityDetectionFailed": "Échec de la détection des capacités de {profile}.",
  "settings.prober.toolCapabilityDetectionFailed":
    "Échec de la détection de la capacité outils de {profile}.",
  "settings.prober.agentCapabilityDetectionFailed":
    "Échec de la détection de la capacité mode agent de {profile}.",

  "settings.profileModal.error.requiredFields": "Remplir tous les champs requis.",
  "settings.profileModal.error.nameLength": "Le nom doit contenir de 1 à {max} caractères.",
  "settings.profileModal.error.nameUnique": "Le nom doit être unique.",

  "settings.serverModal.editTitle": "Modifier le profil de serveur",
  "settings.serverModal.addTitle": "Ajouter un profil de serveur",
  "settings.serverModal.preset.name": "Fournisseur",
  "settings.serverModal.preset.desc":
    "Remplit l'URL de base et le format d'API d'un fournisseur connu. Choisissez Personnalisé pour tout autre point de terminaison.",
  "settings.serverModal.preset.custom": "Personnalisé",
  "settings.serverModal.name.name": "Nom",
  "settings.serverModal.name.desc":
    "Nom lisible affiché dans les paramètres et les sélecteurs de modèle. {max} caractères maximum.",
  "settings.serverModal.apiFormat.name": "Format d’API",
  "settings.serverModal.apiFormat.desc":
    "Format de requête et de réponse utilisé par ce fournisseur.",
  "settings.serverModal.apiFormat.openaiCompatible": "Compatible OpenAI",
  "settings.serverModal.apiFormat.ollama": "Ollama",
  "settings.serverModal.apiFormat.anthropic": "Anthropic",
  "settings.serverModal.baseUrl.name": "URL de base",
  "settings.serverModal.baseUrl.desc":
    "URL du point d’accès du fournisseur, par exemple une base d’API OpenRouter, Ollama ou Anthropic.",
  "settings.serverModal.apiKey.name": "Clé API",
  "settings.serverModal.apiKey.desc":
    "Facultatif. Utilisée comme token bearer pour les fournisseurs exigeant une authentification.",

  "settings.modelProfileModal.editTitle.chat": "Modifier le profil de modèle de chat",
  "settings.modelProfileModal.editTitle.embedding": "Modifier le profil de modèle d’embeddings",
  "settings.modelProfileModal.addTitle.chat": "Ajouter un profil de modèle de chat",
  "settings.modelProfileModal.addTitle.embedding": "Ajouter un profil de modèle d’embeddings",
  "settings.modelProfileModal.name.name": "Nom",
  "settings.modelProfileModal.name.desc":
    "Nom lisible affiché dans les paramètres et les contrôles du chat. {max} caractères maximum.",
  "settings.modelProfileModal.server.name": "Serveur",
  "settings.modelProfileModal.server.desc":
    "Point d’accès du fournisseur utilisé pour appeler ce modèle.",
  "settings.modelProfileModal.model.name": "Modèle",
  "settings.modelProfileModal.model.desc":
    "Nom du modèle récupéré depuis le profil de serveur sélectionné.",
  "settings.modelProfileModal.model.placeholder": "Récupérer les modèles, puis saisir pour filtrer",
  "settings.modelProfileModal.model.fetch": "Récupérer",
  "settings.modelProfileModal.model.empty": "Aucun modèle correspondant",
  "settings.modelProfileModal.temperature.name": "Température",
  "settings.modelProfileModal.temperature.desc":
    "Facultatif. Contrôle l’aléa des réponses ; vide, la valeur par défaut du fournisseur ou de l’application s’applique.",
  "settings.modelProfileModal.maxTokens.name": "Tokens maximum",
  "settings.modelProfileModal.maxTokens.desc":
    "Facultatif. Limite la longueur de la réponse ; vide, la valeur par défaut du fournisseur ou du modèle s’applique, ou 4096 pour Anthropic.",
  "settings.modelProfileModal.contextSize.name": "Taille du contexte",
  "settings.modelProfileModal.contextSize.desc":
    "Limite de tokens facultative. Renseignée depuis les métadonnées du modèle lorsque c’est possible et utilisée pour respecter la fenêtre de contexte du chat.",
  "settings.modelProfileModal.error.selectServer": "Sélectionner d’abord un profil de serveur.",
  "settings.modelProfileModal.error.activeServer": "Sélectionner un profil de serveur actif.",
  "settings.modelProfileModal.error.fetchModels":
    "Récupérer les modèles avant de créer un profil de modèle.",
  "settings.modelProfileModal.error.reasoningEffort":
    "L’effort de raisonnement doit être celui par défaut du fournisseur ou une valeur vérifiée.",
  "settings.modelProfileModal.error.reasoningSummary":
    "Les résumés de raisonnement n’ont pas été vérifiés pour ce profil.",

  "settings.capabilityControls.heading": "Capacités",
  "settings.capabilityControls.testTooltip": "Tester les capacités — {status}",
  "settings.capabilityControls.testingTooltip": "Test des capacités en cours…",
  "settings.capabilityControls.retestTooltip": "Retester les capacités — {status}",
  "settings.capabilityControls.agentic.name": "Mode agentique",
  "settings.capabilityControls.agentic.desc": "Activer la prise en charge vérifiée du mode agent.",
  "settings.capabilityControls.effort.name": "Effort de raisonnement",
  "settings.capabilityControls.effort.desc":
    "Auto utilise la valeur par défaut du fournisseur ou une valeur vérifiée.",
  "settings.capabilityControls.effort.auto": "Auto",
  "settings.capabilityControls.effort.enableAgentic":
    "Activer le mode agentique pour choisir un effort de raisonnement.",
  "settings.capabilityControls.tools.name": "Outils",
  "settings.capabilityControls.tools.desc":
    "Autoriser ce modèle à appeler les outils de notes — lire, rechercher et, avec un accès en écriture, modifier les notes du coffre. Les outils de recherche index et web du mode Réflexion sont régis séparément.",
  "settings.capabilityControls.notVerified": "Non vérifiée par le test de capacités.",
  "settings.capabilityControls.notTested": "Pas encore testée.",
};
