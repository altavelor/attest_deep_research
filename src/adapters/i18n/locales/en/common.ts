export const common = {
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.close": "Close",
  "common.advanced": "Advanced",
  "common.unknownError": "Unknown error",
  "common.copiedToClipboard": "Copied to clipboard.",
  "common.pdfPage": "p. {page}",

  "profile.error.chatModelMissing": "Select a chat model profile before asking a question.",
  "profile.error.embeddingModelMissing":
    "Select an embedding model profile before using this index.",
  "profile.error.serverUnavailable": "The selected server profile is unavailable.",
  "profile.error.indexNotBuilt": "Index this profile before using it in chat or search.",
  "profile.error.indexUnavailable": "The selected index profile is unavailable.",
  "profile.warning.indexNotSelected":
    "Select an indexed profile in Ixplorer settings before searching.",
  "profile.warning.embeddingProfileUnavailable":
    "The selected index's embedding model profile is unavailable. Update it in Ixplorer settings.",
  "profile.warning.embeddingProfileSuspended":
    "The selected index's embedding model profile is suspended. Update it in Ixplorer settings.",
  "profile.warning.embeddingNotSupported":
    "The selected index's embedding model cannot create embeddings. Update it in Ixplorer settings.",
  "profile.warning.embeddingServerUnavailable":
    "The selected index's embedding server is unavailable. Update it in Ixplorer settings.",
};

export type EnCommonMessages = Record<keyof typeof common, string>;
