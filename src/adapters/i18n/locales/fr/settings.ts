import type { EnSettingsMessages } from "../en/settings";

export const settings: EnSettingsMessages = {
  "settings.language.heading": "Langue",
  "settings.language.name": "Langue de l’interface",
  "settings.language.desc": "Langue de l’interface Attest. S’applique sans redémarrer Obsidian.",
  "settings.language.auto": "Automatique (suivre Obsidian)",

  "settings.tab.heading": "Attest",
  "settings.tab.quickStart.title": "Démarrage rapide",
  "settings.tab.quickStart.steps":
    "1. Ajouter un serveur → 2. Ajouter un modèle de chat → 3. (facultatif) Ajouter un index",
  "settings.tab.gateHint": "Ajouter d’abord un profil de modèle de chat",

  "settings.advanced.debugMode.name": "Mode débogage",
  "settings.advanced.debugMode.desc":
    "Journaliser le détail des requêtes et des réponses du plugin. Les clés API sont masquées.",

  "settings.retrieval.heading": "Récupération",
  "settings.retrieval.desc":
    "Détermine comment Attest trouve des éléments probants locaux, issus du graphe, de l’index, des documents et du web avant de répondre.",
  "settings.retrieval.graph.heading": "Graphe Obsidian",
  "settings.retrieval.useLinkedNotes.name": "Utiliser les notes liées",
  "settings.retrieval.useLinkedNotes.desc":
    "Repérer les notes liées à partir des @mentions, des fichiers actifs et des pièces jointes incluses avant la récupération.",
  "settings.retrieval.includeBacklinks.name": "Inclure les rétroliens",
  "settings.retrieval.includeBacklinks.desc":
    "Utiliser les rétroliens directs comme candidats du graphe. Les notes issues de rétroliens ne sont pas parcourues plus loin.",
  "settings.retrieval.expandFilteredContextThroughLinks.name":
    "Étendre les fichiers filtrés via les liens",
  "settings.retrieval.expandFilteredContextThroughLinks.desc":
    "Lorsque les fichiers joints sont en mode Filtre, explorer aussi leurs voisins liés dans le graphe.",
  "settings.retrieval.graphDepth.name": "Profondeur du graphe",
  "settings.retrieval.graphDepth.desc":
    "La profondeur 1 suit les liens directs, les intégrations et les rétroliens. La profondeur 2 est réservée au débogage avancé.",
  "settings.retrieval.search.heading": "Recherche",
  "settings.retrieval.expandSearchQuery.name": "Étendre la requête de recherche",
  "settings.retrieval.expandSearchQuery.desc":
    "Générer des variantes multilingues de la requête avant la récupération afin de trouver les notes rédigées dans d’autres langues. Consomme un appel supplémentaire au modèle de chat par recherche.",
  "settings.retrieval.web.heading": "Web",
  "settings.retrieval.useWebWhenFreshnessNeeded.name":
    "Utiliser le web pour les questions d’actualité",
  "settings.retrieval.useWebWhenFreshnessNeeded.desc":
    "Accorder plus de budget aux éléments probants du web lorsqu’une question porte sur des informations actuelles, récentes, tarifaires ou de version.",

  "settings.newChatDefaults.heading": "Valeurs par défaut des nouveaux chats",
  "settings.newChatDefaults.desc":
    "Configuration initiale de chaque nouveau chat. Les chats enregistrés conservent leurs propres réglages.",
  "settings.newChatDefaults.source.name": "Source par défaut",
  "settings.newChatDefaults.source.desc":
    "Sources d’éléments probants au démarrage d’un nouveau chat.",
  "settings.newChatDefaults.source.none": "Aucune",
  "settings.newChatDefaults.source.indexOnly": "Index",
  "settings.newChatDefaults.source.webOnly": "Web",
  "settings.newChatDefaults.source.indexAndWeb": "Index + Web",
  "settings.newChatDefaults.index.name": "Index par défaut",
  "settings.newChatDefaults.index.desc":
    "Profil d’index au démarrage d’un nouveau chat, utilisé dès que la source inclut l’index.",
  "settings.newChatDefaults.index.empty": "Aucun profil d’index disponible",
  "settings.newChatDefaults.mode.name": "Mode par défaut",
  "settings.newChatDefaults.mode.desc": "Mode de recherche au démarrage d’un nouveau chat.",
  "settings.newChatDefaults.mode.descBlocked":
    "Mode de recherche au démarrage d’un nouveau chat. {hint}",
  "settings.newChatDefaults.mode.thinkingUnavailable":
    "Réflexion nécessite un modèle de chat dont la capacité Agent est vérifiée. Tester les capacités du modèle pour l’activer.",
  "settings.newChatDefaults.mode.instant": "Instantané",
  "settings.newChatDefaults.mode.thinking": "Réflexion",
  "settings.newChatDefaults.model.name": "Modèle par défaut",
  "settings.newChatDefaults.model.desc": "Profil de modèle de chat au démarrage d’un nouveau chat.",
  "settings.newChatDefaults.model.empty": "Aucun profil de modèle de chat disponible",
  "settings.newChatDefaults.activeFile.name": "Inclure le fichier actif comme contexte",
  "settings.newChatDefaults.activeFile.desc":
    "Inclure automatiquement le fichier pris en charge actuellement ouvert comme contexte explicite du chat.",

  "settings.webSources.heading": "Sources externes",
  "settings.webSources.desc":
    "Recherche web externe lancée par l’utilisateur sur les sources activées. Attest n’envoie que la question saisie, jamais le contenu récupéré du coffre.",
  "settings.webSources.count": "{enabled} sur {total} activées",
  "settings.webSources.column.source": "Source",
  "settings.webSources.column.actions": "Actions",
  "settings.webSources.column.state": "État",
  "settings.webSources.categoryCount": "{category} · {enabled}/{total}",
  "settings.webSources.category.serp": "Recherche web générale",
  "settings.webSources.category.neural": "Recherche par IA",
  "settings.webSources.category.academic": "Académique",
  "settings.webSources.category.encyclopedia": "Encyclopédie",
  "settings.webSources.category.community": "Développement et communauté",
  "settings.webSources.category.news": "Actualités",
  "settings.webSources.category.fetch": "Récupération de page en secours",
  "settings.webSources.category.image": "Recherche d’images",
  "settings.webSources.activation.off": "Désactivée",
  "settings.webSources.activation.auto": "Auto — utilisée quand le planificateur la choisit",
  "settings.webSources.activation.always": "Toujours — interrogée à chaque recherche web",
  "settings.webSources.issue.unauthorized": "Identifiants refusés — vérifier la clé API",
  "settings.webSources.issue.rateLimited":
    "Limite de débit dépassée — nouvelle tentative automatique plus tard",
  "settings.webSources.setUp": "Configurer…",
  "settings.webSources.setUpAria": "Configurer {source}",
  "settings.webSources.configure": "Configurer {source}",
  "settings.webSources.lampIssueTitle": "{issue} — cliquer pour passer à « {next} »",
  "settings.webSources.lampTitle": "{source} : {current} — cliquer pour passer à « {next} »",
  "settings.webSources.meta.required": "{fields} requis",
  "settings.webSources.meta.configured": "configuré",

  "settings.webSourceModal.title": "Configurer {source}",
  "settings.webSourceModal.info": "{note}. ",
  "settings.webSourceModal.providerDocs": "Documentation du fournisseur",
  "settings.webSourceModal.field.optional": "Facultatif.",
  "settings.webSourceModal.field.required": "Requis pour activer cette source.",
  "settings.webSourceModal.imageSearch.name": "Utiliser pour la recherche d’images",
  "settings.webSourceModal.imageSearch.desc":
    "Désactivé par défaut. Une fois activé, search_images peut interroger le point d’accès images de ce moteur, ce qui consomme le même quota que la recherche textuelle.",
  "settings.webSourceModal.disabledNotice":
    "{source} désactivée : les identifiants requis sont absents.",
};
