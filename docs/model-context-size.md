# Spec: Model Context Size Discovery

## Objective

Add an optional context-window size to chat model profiles. When a user selects a discovered model, populate the editable field automatically when the provider exposes a positive token limit; otherwise preserve the current manual value.

## Tech Stack

TypeScript, Obsidian settings UI, Vitest, provider REST APIs.

## Commands

- Build: `npm run build`
- Test: `npm test`
- Lint/type-check: `npm run lint`

## Project Structure

- `src/client/common/models.ts`: validates and normalizes model metadata.
- `src/settings/connectionTests.ts`: discovers models and provider metadata.
- `src/settings/SettingsTab.ts`: model profile selection and editable context field.
- `tests/unit/`: unit coverage for discovery and selection behavior.

## Code Style

```ts
const contextLength = readPositiveInteger(model.max_context_length);
```

Use existing TypeScript interfaces, guards, and Obsidian `Setting` controls. Treat provider responses as untrusted data.

## Testing Strategy

Write failing Vitest unit tests first for supported metadata shapes, Ollama detail discovery, and selection fallback. Run focused tests after each increment, then the full suite and build.

## Boundaries

- Always: keep the field optional and user-editable; validate remote values as positive integers.
- Ask first: add dependencies or change persisted schema beyond existing `capabilities.contextLength`.
- Never: infer context size from model names or overwrite a manual value when metadata is absent.

## Success Criteria

- OpenAI-compatible model metadata populates `contextLength` when a supported field is present, including LM Studio's native model metadata endpoint.
- Selecting an Ollama model queries `/api/show` and populates the field when metadata is present.
- Missing, invalid, or failed metadata lookup leaves the field unchanged and does not block selection.
- Saved chat profiles continue to persist the value in `capabilities.contextLength`.

## Open Questions

None. Provider-specific metadata is best-effort and manual input remains the fallback.

## Implementation Plan

1. Extend model discovery contracts and parsers with optional validated context metadata; verify with unit tests.
2. Add best-effort per-model metadata lookup for Ollama; verify request and failure behavior.
3. Connect model selection to automatic field population while preserving manual fallback; verify pure selection logic and build.
4. Run the full test suite, type-check/build, and review the final diff.
