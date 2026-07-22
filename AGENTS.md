# Ixplorer Repository Instructions

## Project and task source

Ixplorer is an open-source Obsidian plugin written in TypeScript.

For issue-driven work, the linked GitHub issue is the source of truth. Before
changing code, read the complete issue, identify every acceptance criterion,
read the applicable `AGENTS.md` files, and inspect the relevant implementation
and tests. Stay within the issue scope; do not make unrelated refactors.

`AGENTS.md` files may be placed in subdirectories (for example, `src/` or
`tests/`). Instructions closest to a changed file supplement this file and take
precedence for that file.

## Git, commits, and pull requests

Use a task branch named one of:

- `feat/<issue-number>-<description>`
- `fix/<issue-number>-<description>`
- `refactor/<issue-number>-<description>`
- `chore/<issue-number>-<description>`

Make atomic Conventional Commits. Each commit must contain one logical change
and use `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, or `chore:`. Do not mix
unrelated work, generated output, secrets, tokens, environment files, personal
paths, or local configuration into a commit. Never edit generated files by hand.
Do not mention yourself in commit messages

Before publishing a task branch, run:

```bash
npm ci
npm run check
```

Both commands must pass. `npm run check` runs type checking, the platform-neutral
core check, tests, dependency-cruiser, formatting, and the production build.

After implementation, validate, commit the intended changes, push the task
branch, and open a pull request against `main`. Link the source issue, request
an independent Codex review, and do not merge the pull request or mark it ready
until review findings are resolved. The PR report must include Summary, Linked
issue, Changes, Validation, Risks, and Review status.

## General implementation rules

- Preserve backward compatibility unless the issue explicitly permits a break.
- Do not add dependencies without a clear, task-specific justification.
- Add or update tests for every changed behavior.
- Handle failures and invalid external input explicitly.
- Treat external data as untrusted; clean up resources, subscriptions,
  listeners, timers, and temporary files.
- Match nearby code style. Comments explain why, not obvious mechanics.

## Architecture

Dependencies point strictly inward:

```text
apps -> adapters -> application -> core
```

| Layer       | Directory          | Responsibility                                                            | May import                  |
| ----------- | ------------------ | ------------------------------------------------------------------------- | --------------------------- |
| core        | `src/core/`        | Platform-neutral domain types and pure logic; no I/O.                     | core                        |
| application | `src/application/` | Use cases and orchestration; ports and contracts.                         | core, application           |
| adapters    | `src/adapters/`    | Port implementations: models, indexing, settings, web, and Obsidian glue. | core, application, adapters |
| apps        | `src/apps/`        | Obsidian entry points, composition root, and UI.                          | any layer                   |

Put new business logic in `core` (pure) or `application` (orchestration), not in
adapters or UI. HTTP, file-system, database, and Obsidian APIs belong only in
`adapters` or `apps`. Application code accesses an external service through a
port in `src/application/ports/` or a contract in `src/application/contracts/`;
implement and inject that port from an adapter. A use case must not construct or
import its adapter.

`npm run depcruise` enforces the layer boundaries and forbids runtime import
cycles. Type-only cycles are non-blocking but should be broken by extracting a
shared type into a low-level leaf module when practical.

### Modules and imports

- Keep one coherent responsibility per module. Split a file approaching roughly
  400 lines instead of extending it into a large multi-purpose file.
- A bounded-context module exposes its intentional public API through a curated
  `index.ts`; consumers import its layer alias (for example,
  `@adapters/research-tools`), not internal deep paths. Internal files must not
  import their own barrel. White-box unit tests may import internals directly.
- Use cross-module and cross-layer aliases: `@core/*`, `@application/*`,
  `@adapters/*`, `@apps/*`, and `@shared/*`. Keep aliases synchronized in
  `tsconfig.json`, `esbuild.config.mjs`, and `vitest.config.ts`. Use relative
  imports for siblings within the same module.
- Extract pure free functions from large classes into focused neighbouring helper
  modules.

### Layer patterns

- Model alternative execution paths as separate strategies behind a common
  interface. The coordinator selects a strategy and orchestrates transitions;
  it does not grow into a branch-heavy implementation. The research use case
  demonstrates this with `ResearchService`, `EagerResearchStrategy`, and
  `AgenticResearchStrategy`.
- Build the dependency-injection graph in `src/apps/obsidian/composition/`
  factories behind `CompositionContext`. `main.ts` owns lifecycle and thin
  wiring only; factories receive context rather than reaching back into the
  plugin instance.
- Keep UI classes focused on rendering and event wiring. Move probing,
  capability discovery, searches, and network calls into services or
  controllers with a narrow context. A controller owns its local state and DOM
  references; shared mutable state remains in the host view. Use explicit
  callbacks such as `requestRedisplay()` or `onOpenChunk()` rather than a
  reference back to the view.
- Split large render or builder code into focused sections, primitives, styles,
  and types. Keep its entry file a thin orchestrator and type re-export surface.

## Testing and validation

Tests live in `tests/` and use Vitest. Prefer deterministic behavioral tests;
do not assert private implementation details or use snapshots where explicit
assertions express the behavior. Mock network calls. Every regression fix needs
a regression test.

Before a refactor that changes execution flow, add characterization tests for
observable behavior such as streaming-event order and fallback paths. Pure code
moves, file splits, and barrel extraction do not require new characterization
tests, but must retain existing coverage. When splitting a source-text contract
test, update it to inspect all relevant modules in the directory, not a single
former file.

The repository's complete validation command is `npm run check`. Its individual
checks are available when diagnosing a failure:

```bash
npm run typecheck
npm run typecheck:core
npm test
npm run depcruise
npm run format
npm run build
```

`typecheck:core` compiles `src/core/`, application ports and contracts with
`lib: ["ES2022"]` and no ambient platform types. Core may use language and web
standards declared in `types/web-standard-globals.d.ts`, but never Node, DOM, or
Obsidian APIs; introduce a port instead.

## Pull request reviews

Review independently and inspect the complete diff against the PR base branch.
Do not assume the implementation is correct because its author says so, and do
not modify the pull-request branch while reviewing. Verify acceptance criteria,
regressions, public API compatibility, explicit error and input handling,
meaningful behavioral tests, scope discipline, absence of credentials or local
configuration, cancellation and races in async work, cleanup of resources, and
untrusted external-data handling.

For each actionable finding, give severity, affected file and line, a concrete
failure scenario, explanation, and the smallest recommended correction.

Treat the following as blocking: security vulnerabilities, data-loss risks,
broken existing behavior, incorrect authorization, unhandled invalid external
input, resource leaks, correctness-affecting races, unsatisfied acceptance
criteria, and missing tests for critical changed behavior.

For Obsidian-specific changes, also verify lifecycle use, disposal of registered
events and DOM handlers, active-editor validation for commands, vault-path
normalization and containment, renamed/deleted-file handling, cancellation,
timeouts and malformed network responses, settings-migration preservation, and
Obsidian Mobile compatibility.
