import type { EnOnboardingMessages } from "../en/onboarding";

export const onboarding: EnOnboardingMessages = {
  "onboarding.title": "Configurer Attest",
  "onboarding.progress": "Étape {step} sur {total}",
  "onboarding.scope.pickOne": "Choisissez une option pour continuer",

  "onboarding.action.back": "Retour",
  "onboarding.action.skip": "Ignorer et configurer manuellement",
  "onboarding.action.continue": "Continuer",
  "onboarding.action.checking": "Vérification…",
  "onboarding.action.startIndexing": "Lancer l’indexation",
  "onboarding.action.finish": "Terminer",
  "onboarding.action.openChat": "Ouvrir la discussion",
  "onboarding.action.addVaultLater": "Ajouter la recherche dans les notes plus tard",
  "onboarding.action.keepIndexing": "Continuer l’indexation en arrière-plan",

  "onboarding.chat.title": "Fournisseur et modèle de discussion",
  "onboarding.chat.intro":
    "Attest crée les profils pour vous au fil des étapes. Tout ceci pourra être modifié plus tard dans les paramètres du module.",

  "onboarding.endpoint.provider.name": "Fournisseur",
  "onboarding.endpoint.provider.chatDesc":
    "Renseigne l’URL de base et le format d’API. Votre modèle d’embedding peut en utiliser un autre.",
  "onboarding.endpoint.provider.embeddingDesc":
    "Le modèle d’embedding peut résider sur un serveur différent de celui du modèle de discussion.",
  "onboarding.endpoint.baseUrl.name": "URL de base",
  "onboarding.endpoint.baseUrl.desc":
    "Renseignée d’après le fournisseur. Modifiez-la pour un point de terminaison auto-hébergé.",
  "onboarding.endpoint.apiKey.name": "Clé d’API (facultative)",
  "onboarding.endpoint.apiKey.desc":
    "Conservée dans les paramètres du module de ce coffre. Les fournisseurs locaux n’en ont pas besoin.",
  "onboarding.endpoint.connection.name": "Connexion",
  "onboarding.endpoint.connection.action": "Tester la connexion",
  "onboarding.endpoint.connection.desc":
    "Chargez la liste des modèles pour confirmer que le point de terminaison répond.",
  "onboarding.endpoint.connection.testing": "Contact du fournisseur en cours…",
  "onboarding.endpoint.connection.mobileLocal":
    "Les fournisseurs de modèles locaux ne sont pas disponibles sur Obsidian Mobile. Choisissez un fournisseur cloud.",
  "onboarding.endpoint.model.chatName": "Modèle de discussion",
  "onboarding.endpoint.model.embeddingName": "Modèle d’embedding",
  "onboarding.endpoint.model.desc": "{count} modèles correspondent à ce rôle.",
  "onboarding.endpoint.model.empty": "Testez la connexion pour charger la liste des modèles.",
  "onboarding.endpoint.model.placeholder": "Sélectionnez un modèle",
  "onboarding.endpoint.model.testing": "Test en cours",

  "onboarding.scope.title": "D’où doivent venir les réponses ?",
  "onboarding.scope.intro":
    "C’est le seul choix qui change la quantité de configuration restante. Chercher dans votre coffre exige un modèle d’embedding et un index ; le web n’exige ni l’un ni l’autre.",
  "onboarding.scope.notesAndWeb.name": "Mes notes et le web",
  "onboarding.scope.notesAndWeb.desc":
    "La formule complète. Encore deux étapes : un modèle d’embedding, puis les dossiers à indexer.",
  "onboarding.scope.webOnly.name": "Le web uniquement",
  "onboarding.scope.webOnly.desc":
    "Des réponses sourcées depuis le web ouvert, plus la note que vous avez ouverte. Ni index ni modèle d’embedding. DuckDuckGo est déjà actif et ne demande aucune clé.",
  "onboarding.scope.notesOnly.name": "Mes notes uniquement",
  "onboarding.scope.notesOnly.desc":
    "Rien ne quitte le coffre, hormis la question elle-même, envoyée à votre modèle de discussion.",
  "onboarding.scope.remaining.two": "Encore 2 étapes",
  "onboarding.scope.remaining.none": "Terminé après cette étape",

  "onboarding.embedding.title": "Le modèle qui lit vos notes",
  "onboarding.embedding.intro":
    "Il peut venir d’un autre fournisseur que votre modèle de discussion : une combinaison courante associe un modèle de discussion dans le cloud à des embeddings locaux, afin que le texte des notes ne quitte jamais la machine.",
  "onboarding.embedding.sameAsChat.name": "Même serveur que le modèle de discussion",
  "onboarding.embedding.previousProvider": "précédemment : comme la discussion ({provider})",
  "onboarding.embedding.sameAsChat.desc":
    "Désactivez cette option pour calculer les embeddings sur un autre point de terminaison. Un second profil de serveur sera alors créé.",
  "onboarding.embedding.rebuildWarning":
    "Changer ce modèle plus tard impose de reconstruire l’index : les vecteurs de deux modèles ne sont pas comparables.",
  "onboarding.embedding.unverified":
    "La capacité d’embedding n’a pas pu être vérifiée. Votre modèle de discussion fonctionne déjà : vous pouvez terminer avec le web et ajouter la recherche dans le coffre plus tard.",
  "onboarding.embedding.useWebInstead": "Utiliser le web à la place",

  "onboarding.folders.title": "Quelles notes Attest peut-il lire ?",
  "onboarding.folders.intro": "Seuls ces dossiers sont indexés, et seuls eux peuvent être cités.",
  "onboarding.folders.mode.name": "Dossiers",
  "onboarding.folders.mode.desc":
    "Commencez petit : élargir plus tard n’est qu’une actualisation incrémentale peu coûteuse.",
  "onboarding.folders.mode.wholeVault": "Coffre entier",
  "onboarding.folders.mode.selected": "Dossiers sélectionnés",
  "onboarding.folders.paths.name": "Sélection",
  "onboarding.folders.paths.action": "Choisir des dossiers…",
  "onboarding.folders.paths.empty": "Rien n’est encore sélectionné.",
  "onboarding.folders.paths.remove": "Retirer {path}",
  "onboarding.folders.excluded.name": "Exclus",
  "onboarding.folders.excluded.desc": "Prérempli.",
  "onboarding.folders.location.name": "Emplacement de l’index",
  "onboarding.folders.location.desc": "Dans le coffre, afin qu’il soit synchronisé avec vos notes.",
  "onboarding.folders.location.outsideVault":
    "L’index doit rester dans le coffre. Supprimez les segments « .. » et la barre oblique initiale.",
  "onboarding.folders.mobileWarning":
    "Sur mobile, la première construction est lente : petits lots, une page de PDF à la fois, gros PDF ignorés. Construisez l’index sur ordinateur puis synchronisez, ou empruntez pour l’instant la voie « web uniquement ».",

  "onboarding.finish.web.title": "La recherche web est prête",
  "onboarding.finish.web.status": "2 profils · aucune attente",
  "onboarding.finish.vault.title": "Indexation des notes en cours",
  "onboarding.finish.vault.status": "s’exécute en arrière-plan",
  "onboarding.finish.vault.doneTitle": "La recherche dans vos notes est prête",
  "onboarding.finish.vault.doneStatus": "indexation terminée",
  "onboarding.finish.vault.errorTitle": "Indexation interrompue",
  "onboarding.finish.vault.errorStatus": "échec de l'indexation",
  "onboarding.finish.tag.server": "Profil de serveur",
  "onboarding.finish.tag.chat": "Modèle de discussion",
  "onboarding.finish.tag.embedding": "Modèle d’embedding",
  "onboarding.finish.tag.index": "Profil d’index",
  "onboarding.finish.stats.files": "{scanned} / {total} fichiers",
  "onboarding.finish.stats.chunks": "{embedded} / {total} segments",
  "onboarding.finish.webIntro":
    "Rien à indexer, la configuration s’arrête donc ici. Posez une question et la réponse citera les pages web utilisées.",
  "onboarding.finish.vaultIntro":
    "La discussion s’ouvre maintenant ; les réponses issues du coffre s’améliorent à mesure que les fragments arrivent. L’index continue de se construire même si vous fermez cette fenêtre.",
  "onboarding.finish.vaultDoneIntro":
    "Toutes les notes sélectionnées sont indexées. Posez une question et la réponse citera les notes utilisées.",
  "onboarding.finish.vaultErrorIntro":
    "Le modèle de chat fonctionne, vous pouvez commencer dès maintenant. Ouvrez le profil d'index dans les paramètres pour voir la cause et relancer.",
  "onboarding.finish.indexingStarting": "Démarrage de la première construction de l’index…",

  "command.runSetup": "Lancer la configuration initiale",
};
