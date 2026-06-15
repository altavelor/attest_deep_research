# Context Assembler Phase 2

## Objective

Phase 2 adds Obsidian graph context discovery before vault retrieval. Ixplorer uses explicit context, active files, exact `@mentions`, and selected attachments as roots, discovers linked notes through Obsidian metadata, and feeds graph neighbors into retrieval without hard-including them as authoritative evidence.

## Scope

- Add graph context discovery using Obsidian `metadataCache` first.
- Add a markdown parser fallback for basic wiki links, embeds, heading links, and markdown `.md` links.
- Use graph files as boosted retrieval candidates.
- Keep `filter` mode strict unless `Expand filtered files through links` is enabled.
- Add user-facing graph diagnostics plus raw debug JSON.
- Keep web evidence outside the new budget planner until a later phase.

## Search Engine Defaults

- `useLinkedNotes`: `true`
- `includeBacklinks`: `true`
- `expandFilteredContextThroughLinks`: `false`
- `graphContextDepth`: `1`
- `maxForwardLinksPerRoot`: `20`
- `maxEmbedsPerRoot`: `20`
- `maxBacklinksPerRoot`: `20`
- `maxGraphCandidatesTotal`: `40`

## Retrieval Policy

Graph-discovered files are not hard includes. They are searched as boosted source paths and may receive up to roughly 25% of the local evidence slots. Explicit context remains authoritative and has priority over graph context.

## Diagnostics

The normal UI shows compact graph counts and top included linked notes. Full graph candidates, dropped items, unresolved links, and budget details are available under `Debug details`.

## Verification

- Unit tests cover markdown parser fallback and graph integration in `ContextAssembler`.
- Settings migration tests cover new `Search engine` defaults.
- Full verification should run `npm test` and `npm run lint`.
