export const settings = {
  "settings.language.heading": "Language",
  "settings.language.name": "Interface language",
  "settings.language.desc":
    "Language of the Attest interface. Applies without restarting Obsidian.",
  "settings.language.auto": "Automatic (follow Obsidian)",

  "settings.tab.heading": "Attest",
  "settings.tab.quickStart.title": "Quick start",
  "settings.tab.quickStart.steps":
    "1. Add a server → 2. Add a chat model → 3. (optional) Add an index",
  "settings.tab.gateHint": "Add a chat model profile first",
  "settings.tab.setup.name": "Setup wizard",
  "settings.tab.setup.rerunDesc":
    "Reopens the wizard filled in with your current setup and updates the profiles it created.",
  "settings.tab.setup.rerunAction": "Run setup again",
  "settings.tab.setup.action": "Run setup",

  "settings.advanced.debugMode.name": "Debug mode",
  "settings.advanced.debugMode.desc":
    "Log plugin request and response details. API keys are redacted.",

  "settings.retrieval.heading": "Retrieval",
  "settings.retrieval.desc":
    "Controls how Attest finds local, graph, index, document, and web evidence before answering.",
  "settings.retrieval.graph.heading": "Obsidian graph",
  "settings.retrieval.useLinkedNotes.name": "Use linked notes",
  "settings.retrieval.useLinkedNotes.desc":
    "Discover linked notes from @mentions, active files, and included attachments before retrieval.",
  "settings.retrieval.includeBacklinks.name": "Include backlinks",
  "settings.retrieval.includeBacklinks.desc":
    "Use one-hop backlinks as graph candidates. Backlink notes are not traversed further.",
  "settings.retrieval.expandFilteredContextThroughLinks.name":
    "Expand filtered files through links",
  "settings.retrieval.expandFilteredContextThroughLinks.desc":
    "When attached files are in Filter mode, also search their linked graph neighbors.",
  "settings.retrieval.graphDepth.name": "Graph depth",
  "settings.retrieval.graphDepth.desc":
    "Depth 1 follows direct links, embeds, and backlinks. Depth 2 is reserved for advanced debugging.",
  "settings.retrieval.search.heading": "Search",
  "settings.retrieval.expandSearchQuery.name": "Expand search query",
  "settings.retrieval.expandSearchQuery.desc":
    "Generate cross-language query variants before retrieval so notes written in other languages are found. Uses an extra chat-model call per search.",
  "settings.retrieval.web.heading": "Web",
  "settings.retrieval.useWebWhenFreshnessNeeded.name": "Use web for freshness questions",
  "settings.retrieval.useWebWhenFreshnessNeeded.desc":
    "Give web evidence more budget when a question asks for current, latest, price, or release information.",

  "settings.newChatDefaults.heading": "New chat defaults",
  "settings.newChatDefaults.desc":
    "Starting configuration of every new chat. Saved chats keep their own settings.",
  "settings.newChatDefaults.source.name": "Default source",
  "settings.newChatDefaults.source.desc": "Evidence sources a new chat starts with.",
  "settings.newChatDefaults.source.none": "None",
  "settings.newChatDefaults.source.indexOnly": "Index",
  "settings.newChatDefaults.source.webOnly": "Web",
  "settings.newChatDefaults.source.indexAndWeb": "Index + Web",
  "settings.newChatDefaults.index.name": "Default index",
  "settings.newChatDefaults.index.desc":
    "Index profile a new chat starts with, used whenever the source includes Index.",
  "settings.newChatDefaults.index.empty": "No available index profiles",
  "settings.newChatDefaults.mode.name": "Default mode",
  "settings.newChatDefaults.mode.desc": "Research mode a new chat starts with.",
  "settings.newChatDefaults.mode.descBlocked": "Research mode a new chat starts with. {hint}",
  "settings.newChatDefaults.mode.thinkingUnavailable":
    "Thinking needs a chat model with a verified Agent capability. Test the model's capabilities to enable it.",
  "settings.newChatDefaults.mode.instant": "Instant",
  "settings.newChatDefaults.mode.thinking": "Thinking",
  "settings.newChatDefaults.model.name": "Default model",
  "settings.newChatDefaults.model.desc": "Chat model profile a new chat starts with.",
  "settings.newChatDefaults.model.empty": "No available chat model profiles",
  "settings.newChatDefaults.activeFile.name": "Include active file as context",
  "settings.newChatDefaults.activeFile.desc":
    "Automatically include the currently open supported file as explicit chat context.",

  "settings.webSources.heading": "External sources",
  "settings.webSources.desc":
    "External, user-initiated web search across the enabled sources. Attest sends only the typed question, never retrieved vault content.",
  "settings.webSources.count": "{enabled} of {total} enabled",
  "settings.webSources.column.source": "Source",
  "settings.webSources.column.actions": "Actions",
  "settings.webSources.column.state": "State",
  "settings.webSources.categoryCount": "{category} · {enabled}/{total}",
  "settings.webSources.category.serp": "General web search",
  "settings.webSources.category.neural": "AI search",
  "settings.webSources.category.academic": "Academic",
  "settings.webSources.category.encyclopedia": "Encyclopedia",
  "settings.webSources.category.community": "Developer & community",
  "settings.webSources.category.news": "News",
  "settings.webSources.category.fetch": "Page fetch fallback",
  "settings.webSources.category.image": "Image search",
  "settings.webSources.activation.off": "Off",
  "settings.webSources.activation.auto": "Auto — used when the planner picks it",
  "settings.webSources.activation.always": "Always — queried on every web search",
  "settings.webSources.issue.unauthorized": "Credentials rejected — check the API key",
  "settings.webSources.issue.rateLimited": "Rate limit exceeded — retries automatically later",
  "settings.webSources.setUp": "Set up…",
  "settings.webSources.setUpAria": "Set up {source}",
  "settings.webSources.configure": "Configure {source}",
  "settings.webSources.lampIssueTitle": '{issue} — click to switch to "{next}"',
  "settings.webSources.lampTitle": '{source}: {current} — click to switch to "{next}"',
  "settings.webSources.meta.required": "{fields} required",
  "settings.webSources.meta.configured": "configured",

  "settings.webSourceModal.title": "Configure {source}",
  "settings.webSourceModal.info": "{note}. ",
  "settings.webSourceModal.providerDocs": "Provider documentation",
  "settings.webSourceModal.field.optional": "Optional.",
  "settings.webSourceModal.field.required": "Required to enable this source.",
  "settings.webSourceModal.imageSearch.name": "Use for image search",
  "settings.webSourceModal.imageSearch.desc":
    "Off by default. When on, search_images may query this engine's image endpoint, which spends the same quota as text search.",
  "settings.webSourceModal.disabledNotice": "{source} disabled: required credentials are missing.",
};

export type EnSettingsMessages = Record<keyof typeof settings, string>;
