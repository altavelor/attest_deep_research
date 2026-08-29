export const onboarding = {
  "onboarding.title": "Set up Attest",
  "onboarding.progress": "Step {step} of {total}",
  "onboarding.scope.pickOne": "Pick one to continue",

  "onboarding.action.back": "Back",
  "onboarding.action.skip": "Skip, configure manually",
  "onboarding.action.continue": "Continue",
  "onboarding.action.checking": "Checking…",
  "onboarding.action.startIndexing": "Start indexing",
  "onboarding.action.finish": "Finish",
  "onboarding.action.openChat": "Open chat",
  "onboarding.action.addVaultLater": "Add vault search later",
  "onboarding.action.keepIndexing": "Keep indexing in background",

  "onboarding.chat.title": "Chat provider and model",
  "onboarding.chat.intro":
    "Attest creates the profiles for you as you go. Everything here can be changed later in the plugin settings.",

  "onboarding.endpoint.provider.name": "Provider",
  "onboarding.endpoint.provider.chatDesc":
    "Fills the base URL and API format. Your embedding model can use a different one.",
  "onboarding.endpoint.provider.embeddingDesc":
    "The embedding model may live on another server than the chat model.",
  "onboarding.endpoint.baseUrl.name": "Base URL",
  "onboarding.endpoint.baseUrl.desc":
    "Filled from the provider. Edit it for a self-hosted endpoint.",
  "onboarding.endpoint.apiKey.name": "API key (optional)",
  "onboarding.endpoint.apiKey.desc":
    "Kept in this vault's plugin settings. Local providers need none.",
  "onboarding.endpoint.connection.name": "Connection",
  "onboarding.endpoint.connection.action": "Test connection",
  "onboarding.endpoint.connection.desc": "Load the model list to confirm the endpoint answers.",
  "onboarding.endpoint.connection.testing": "Contacting the provider…",
  "onboarding.endpoint.connection.mobileLocal":
    "Local model providers are not available on Obsidian Mobile. Choose a cloud provider.",
  "onboarding.endpoint.model.chatName": "Chat model",
  "onboarding.endpoint.model.embeddingName": "Embedding model",
  "onboarding.endpoint.model.desc": "{count} models match this role.",
  "onboarding.endpoint.model.empty": "Test the connection to load the model list.",
  "onboarding.endpoint.model.placeholder": "Select a model",
  "onboarding.endpoint.model.testing": "Testing",

  "onboarding.scope.title": "Where should answers come from?",
  "onboarding.scope.intro":
    "This is the only choice that changes how much setup is left. Searching your vault needs an embedding model and an index; the web needs neither.",
  "onboarding.scope.notesAndWeb.name": "My notes and the web",
  "onboarding.scope.notesAndWeb.desc":
    "The full thing. Two more steps: an embedding model, then the folders to index.",
  "onboarding.scope.webOnly.name": "The web only",
  "onboarding.scope.webOnly.desc":
    "Cited answers from the open web, plus whatever note you have open. No index and no embedding model. DuckDuckGo is already on and needs no key.",
  "onboarding.scope.notesOnly.name": "My notes only",
  "onboarding.scope.notesOnly.desc":
    "Nothing leaves the vault except the question itself, to your chat model.",
  "onboarding.scope.remaining.two": "2 steps left",
  "onboarding.scope.remaining.none": "Done after this",

  "onboarding.embedding.title": "Model that reads your notes",
  "onboarding.embedding.intro":
    "This can be a different provider from your chat model — a common setup is a cloud chat model with local embeddings, so note text never leaves the machine.",
  "onboarding.embedding.sameAsChat.name": "Same server as the chat model",
  "onboarding.embedding.previousProvider": "was: Same as chat ({provider})",
  "onboarding.embedding.sameAsChat.desc":
    "Turn this off to embed on another endpoint. A second server profile is then created.",
  "onboarding.embedding.rebuildWarning":
    "Changing this model later means rebuilding the index: vectors from two models are not comparable.",
  "onboarding.embedding.unverified":
    "Embedding capability could not be verified. Your chat model already works, so you can finish with the web instead and add vault search later.",
  "onboarding.embedding.useWebInstead": "Use the web instead",

  "onboarding.folders.title": "Which notes may Attest read?",
  "onboarding.folders.intro": "Only these folders are indexed, and only they can be cited.",
  "onboarding.folders.mode.name": "Folders",
  "onboarding.folders.mode.desc": "Start narrow — widening later is a cheap incremental refresh.",
  "onboarding.folders.mode.wholeVault": "Whole vault",
  "onboarding.folders.mode.selected": "Selected folders",
  "onboarding.folders.paths.name": "Selected",
  "onboarding.folders.paths.action": "Choose folders…",
  "onboarding.folders.paths.empty": "Nothing selected yet.",
  "onboarding.folders.paths.remove": "Remove {path}",
  "onboarding.folders.excluded.name": "Excluded",
  "onboarding.folders.excluded.desc": "Prefilled.",
  "onboarding.folders.location.name": "Index location",
  "onboarding.folders.location.desc": "Inside the vault, so it syncs with your notes.",
  "onboarding.folders.location.outsideVault":
    'The index must stay inside the vault. Remove any ".." segment or leading slash.',
  "onboarding.folders.mobileWarning":
    "On mobile a first build is slow: small batches, one PDF page at a time, large PDFs skipped. Build on desktop and sync, or take the web-only path for now.",

  "onboarding.finish.web.title": "Web research is ready",
  "onboarding.finish.web.status": "2 profiles · 0 s wait",
  "onboarding.finish.vault.title": "Vault search is indexing",
  "onboarding.finish.vault.status": "runs in background",
  "onboarding.finish.vault.doneTitle": "Vault search is ready",
  "onboarding.finish.vault.doneStatus": "indexing finished",
  "onboarding.finish.vault.errorTitle": "Vault search stopped",
  "onboarding.finish.vault.errorStatus": "indexing failed",
  "onboarding.finish.tag.server": "Server profile",
  "onboarding.finish.tag.chat": "Chat model",
  "onboarding.finish.tag.embedding": "Embedding model",
  "onboarding.finish.tag.index": "Index profile",
  "onboarding.finish.stats.files": "{scanned} / {total} files",
  "onboarding.finish.stats.chunks": "{embedded} / {total} chunks",
  "onboarding.finish.webIntro":
    "Nothing to index, so setup ends here. Ask a question and the answer will cite the web pages it used.",
  "onboarding.finish.vaultIntro":
    "Chat opens now; vault answers improve as chunks land. The index keeps building if you close this dialog.",
  "onboarding.finish.vaultDoneIntro":
    "Every selected note is indexed. Ask a question and the answer will cite the notes it used.",
  "onboarding.finish.vaultErrorIntro":
    "The chat model works, so you can start now. Open the index profile in settings to see what failed and run it again.",
  "onboarding.finish.indexingStarting": "Starting the first index build…",

  "command.runSetup": "Run first-run setup",
};

export type EnOnboardingMessages = Record<keyof typeof onboarding, string>;
