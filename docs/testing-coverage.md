# Test coverage

## Commands

```bash
npm test              # fast run, no instrumentation
npm run test:coverage # V8 coverage, writes ./coverage
```

`test:coverage` instruments every executable file under `src/**/*.ts`, including
files no test imports, so unexercised modules are visible instead of absent.
Only `*.d.ts` declarations are excluded. `src/apps` is deliberately reported.

Reports land in the gitignored `coverage/` directory:

| Report       | Path                             | Use                         |
| ------------ | -------------------------------- | --------------------------- |
| terminal     | stdout                           | local feedback              |
| HTML         | `coverage/index.html`            | line-by-line inspection     |
| LCOV         | `coverage/lcov.info`             | CI artifact, external tools |
| JSON summary | `coverage/coverage-summary.json` | baselines and thresholds    |

## Baseline

Measured on 2026-08-03 (1205 tests, Vitest 1.6.1, `@vitest/coverage-v8` 1.6.1)
before the behavioural UI tests of this change were added.

| Scope             | Statements | Branches | Functions | Lines  |
| ----------------- | ---------- | -------- | --------- | ------ |
| total             | 69.02%     | 77.68%   | 84.89%    | 69.02% |
| `src/core`        | 93.47%     | 86.07%   | 93.01%    | 93.47% |
| `src/application` | 89.86%     | 82.62%   | 89.09%    | 89.86% |
| `src/adapters`    | 87.06%     | 76.39%   | 86.99%    | 87.06% |
| `src/apps`        | 16.66%     | 55.85%   | 55.81%    | 16.66% |
| `src/shared`      | 95.40%     | 91.53%   | 100.00%   | 95.40% |

`src/apps` is the known gap: Obsidian views, settings, and chat rendering had no
executable tests, only source-text assertions. Its statement figure is the honest
starting point for later work, not a number to hide by excluding the directory.

After the behavioural UI tests landed (1227 tests):

| Scope             | Statements | Branches | Functions | Lines  |
| ----------------- | ---------- | -------- | --------- | ------ |
| total             | 70.17%     | 77.65%   | 84.51%    | 70.17% |
| `src/core`        | 93.50%     | 86.10%   | 93.38%    | 93.50% |
| `src/application` | 89.86%     | 82.62%   | 89.09%    | 89.86% |
| `src/adapters`    | 87.06%     | 76.39%   | 86.99%    | 87.06% |
| `src/apps`        | 20.95%     | 58.77%   | 57.03%    | 20.95% |
| `src/shared`      | 95.40%     | 91.53%   | 100.00%   | 95.40% |

## Thresholds

Non-regression thresholds are enabled for the two inward layers only, aggregated
per glob, never per file. Each value sits a few points below the measured
baseline so unrelated refactors do not fail CI on rounding, while a real drop in
exercised behaviour does.

| Glob                 | Statements | Branches | Functions | Lines |
| -------------------- | ---------- | -------- | --------- | ----- |
| `src/core/**`        | 90         | 83       | 90        | 90    |
| `src/application/**` | 86         | 79       | 86        | 86    |

Branch coverage is the figure to watch: error paths, fallbacks, and cancellation
branches are where an untested regression actually hides. Coverage proves code
ran, not that assertions were meaningful — treat it as a floor, not a goal.

## Error-branch hardening (issue #18, adapters and core)

Executable tests for malformed, truncated, and cancelled external input were
added for the six weakest branch files. Branch coverage of each, measured with
`npm run test:coverage` before and after (covered/total, V8 counts more branches
once more paths execute):

| File                                                         | Before       | After         |
| ------------------------------------------------------------ | ------------ | ------------- |
| `core/media/imageHeader.ts`                                  | 25/47 53.2%  | 90/100 90.0%  |
| `adapters/extractors/images/archiveImages.ts`                | 36/64 56.3%  | 87/95 91.6%   |
| `adapters/indexing/inventory/IndexDescription.ts`            | 31/59 52.5%  | 72/77 93.5%   |
| `adapters/indexing/inventory/FileVectorIndexInventory.ts`    | 91/136 66.9% | 154/173 89.0% |
| `adapters/model-provider/chat/streaming/ollamaChatStream.ts` | 39/59 66.1%  | 71/80 88.8%   |
| `.../chat/responses/OpenAiResponsesStreamParser.ts`          | 36/54 66.7%  | 93/93 100%    |

Aggregates after this change: total 70.44% statements / 79.62% branches,
`src/core` 94.27% / 87.61%, `src/adapters` 87.47% / 79.43%. The summary table and
the `src/adapters` threshold are updated separately.
