# Contributing to Attest

Thank you for considering a contribution. Attest is an Obsidian plugin written in TypeScript with a
strict layered architecture, so a small amount of process keeps changes reviewable.

## Ways to contribute

- Report a reproducible bug through the [issue templates](.github/ISSUE_TEMPLATE).
- Ask questions and share ideas in [Discussions](https://github.com/altavelor/attest_deep_research/discussions).
- Improve documentation, translations, or tests.
- Implement an issue labelled `status:ready`.

Report vulnerabilities privately through the [Security policy](SECURITY.md), never in a public issue.

## Before you start

Open or comment on an issue before writing code for anything beyond a small fix. This avoids
duplicated work and confirms the change fits the plugin's scope. The linked issue is the source of
truth: read every acceptance criterion before changing code, and stay inside the stated scope.

## Development setup

Node.js 22 and npm are required.

```bash
npm ci
npm run dev
```

`npm run dev` starts an incremental build. To test inside Obsidian, build the plugin and copy
`dist/main.js`, `dist/manifest.json`, and `dist/styles.css` into
`<vault>/.obsidian/plugins/attest/`, then reload Obsidian.

Project commands, architecture, and release requirements are described in the
[Technical reference](docs/technical-reference.md).

## Architecture rules

Dependencies point strictly inward: `apps -> adapters -> application -> core`.

- `src/core/` holds platform-neutral domain types and pure logic, with no I/O and no Node, DOM, or
  Obsidian APIs.
- `src/application/` holds use cases, ports, and contracts.
- `src/adapters/` implements ports; HTTP, file system, and Obsidian APIs belong here or in
  `src/apps/`.
- A use case never constructs or imports its adapter — inject the port instead.
- Import across modules through the aliases `@core/*`, `@application/*`, `@adapters/*`, `@apps/*`,
  and `@shared/*`, and through a module's public `index.ts` rather than deep paths.

`npm run depcruise` enforces these boundaries. The complete rules live in [AGENTS.md](AGENTS.md).

## Code style

- Match the style of surrounding code.
- Comments are limited to a short JSDoc description before a function or class, at most three
  sentences and 120 words. Do not comment fields, constants, or obvious operations; express intent
  through names and structure.
- Split a file approaching roughly 400 lines instead of extending it.
- Do not add dependencies without a task-specific justification.

## Tests

Tests live in `tests/` and use Vitest. Add or update tests for every changed behaviour, and add a
regression test for every bug fix. Prefer deterministic behavioural assertions over snapshots, mock
network calls, and do not assert private implementation details.

## Commits and branches

Use a task branch named `feat/`, `fix/`, `refactor/`, or `chore/` followed by the issue number and a
short description, for example `fix/42-citation-offsets`.

Write atomic [Conventional Commits](https://www.conventionalcommits.org/) — one logical change each,
prefixed with `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, or `chore:`. Never commit secrets,
tokens, environment files, personal paths, local configuration, or generated output.

## Validation

Both commands must pass before you open a pull request:

```bash
npm ci
npm run check
```

`npm run check` runs type checking, the platform-neutral core check, tests with coverage,
dependency-cruiser, formatting, and the production build.

## Pull requests

Open the pull request against `main` and fill in the template: linked issue, summary, changes,
acceptance criteria, validation, and risks. Keep the change focused — unrelated refactors make
review harder and are usually asked to be split out.

CI must be green, and review findings must be resolved before merge. Preserve backward compatibility
unless the issue explicitly permits a break, and call out any behaviour change in the pull request.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
