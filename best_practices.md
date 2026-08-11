# Best Practices — Attest

These rules are mandatory for code in this repository. [AGENTS.md](AGENTS.md) is
the source of truth; this file contains the portion that is verifiable in review.

## Architectural layers

Dependencies point strictly inward: `apps -> adapters -> application -> core`.

| Layer       | Directory          | May import                  |
| ----------- | ------------------ | --------------------------- |
| core        | `src/core/`        | core                        |
| application | `src/application/` | core, application           |
| adapters    | `src/adapters/`    | core, application, adapters |
| apps        | `src/apps/`        | any layer                   |

- `src/core/` contains platform-neutral types and pure logic with no I/O. Node,
  DOM, and Obsidian APIs are forbidden here; introduce a port instead. Only
  language and web standards declared in `types/web-standard-globals.d.ts` are
  permitted.
- HTTP, the file system, databases, and the Obsidian API belong only in
  `adapters` or `apps`.
- Put new business logic in `core` (pure) or `application` (orchestration), not
  in adapters or UI.
- Application code accesses an external service through a port in
  `src/application/ports/` or a contract in `src/application/contracts/`. A use
  case must not construct or import its adapter.

## Modules and imports

- One module has one coherent responsibility. Split a file that approaches 400
  lines instead of extending it.
- A bounded-context module exposes its API through a curated `index.ts`.
  Consumers import the layer alias (for example, `@adapters/research-tools`),
  not internal deep paths. Internal files do not import their own barrel.
- Use only `@core/*`, `@application/*`, `@adapters/*`, `@apps/*`, and
  `@shared/*` aliases for cross-module and cross-layer imports. Use relative
  imports for sibling files within a module.
- Keep aliases synchronized in `tsconfig.json`, `esbuild.config.mjs`, and
  `vitest.config.ts`.
- Runtime import cycles are forbidden. Break type cycles by extracting the
  shared type into a low-level leaf module.
- Extract pure free functions from large classes into focused neighbouring helper
  modules.

## Layer patterns

- Model alternative execution paths as separate strategies behind a shared
  interface. The coordinator selects a strategy and manages transitions; it
  does not grow into a branch-heavy implementation.
- Build the dependency-injection graph in factories under
  `src/apps/obsidian/composition/` behind `CompositionContext`. `main.ts` owns
  lifecycle and thin wiring only; factories receive context rather than reaching
  into the plugin instance.
- UI classes render and subscribe to events. Move probing, capability discovery,
  searches, and network calls into services or controllers with narrow context.
  A controller owns its local state and DOM references; shared mutable state
  remains in the view. Communicate with the view through explicit callbacks such
  as `requestRedisplay()`, not a reference to the view itself.
- Split large rendering or builder code into sections, primitives, styles, and
  types; keep the entry file a thin orchestrator and re-export surface.

## Reliability

- Preserve backward compatibility unless the task explicitly permits a break.
- Handle failures and invalid external input explicitly.
- Treat external data as untrusted.
- Clean up resources, subscriptions, listeners, timers, and temporary files.
- Async work supports cancellation and timeouts; races are not permitted.
- Normalize storage paths and check that they do not escape their directory.
- Handle file renames and deletions, malformed network responses, settings
  migration with data preservation, and Obsidian Mobile compatibility.
- Add dependencies only with a clear task-specific justification.

## Comments

Only a short JSDoc directly before a function or class is permitted: no more
than three sentences and 120 words. Comments on fields, constants, sections,
obvious operations, and historical rationale are forbidden—express the intent
through names and structure.

## Tests

- Tests live in `tests/` and use Vitest.
- Every changed behavior has a test; every bug fix has a regression test.
- Tests are deterministic and behavioral; do not use private implementation
  details or snapshots in place of explicit assertions. Mock network calls.
- Before a refactor that changes execution flow, add characterization tests for
  observable behavior such as streaming-event order and fallback paths.
- Pure code moves, file splits, and barrel extraction do not require new
  characterization tests, but must preserve existing coverage.

## Commits

Use atomic Conventional Commits with `feat:`, `fix:`, `refactor:`, `test:`,
`docs:`, or `chore:` prefixes. One commit contains one logical change. Do not
commit unrelated changes, generated files, secrets, tokens, environment files,
personal paths, or local configuration. Never edit generated files manually.
