# Attest command actions

## Behaviour

- **Ask Attest about the current note** opens the chat, attaches the Markdown note, and focuses the composer without submitting.
- **Ask Attest about selected text** requires a non-empty editor selection, attaches its Markdown note, and prepares an editable quoted prompt without submitting.
- **Find related notes** attaches the current Markdown note and submits a localized prompt using index-only search.
- **Update index** starts an incremental update for the active index profile.
- **Summarize current note** attaches the current Markdown note and submits a localized prompt without index or web search.
- The ribbon action opens Attest in the right sidebar and reuses an existing chat view.
- Conversation sources are available only after at least one assistant answer has completed.

## Persistence boundary

Attachments prepared by a command are persisted immediately when the command targets an existing saved chat. The unsent composer draft remains local to the open view because saved chats do not currently have a draft field.
