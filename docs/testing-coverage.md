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

## Coverage report in a pull request

CI runs `scripts/coverage-report.mjs` after `npm run test:coverage`. The script
reads `coverage/lcov.info` and the pull request's own diff, writes the report to
the job summary, and posts or updates a single pull-request comment marked with
`<!-- ixplorer-coverage-report -->`. Nothing is uploaded anywhere: the report is
produced inside the workflow run from local files only.

Run it locally the same way CI does:

```bash
npm run test:coverage
node scripts/coverage-report.mjs --base origin/main   # add --out <file> to append the Markdown
```

### Changed lines

The first section answers the review question the totals cannot: is the code
this pull request adds actually exercised? It intersects the lines added by
`git diff --unified=0 <base>...<head> -- src` with the lines V8 instrumented, so
only executable added lines under `src/` count — blank lines, comments, type-only
declarations, and deleted lines are excluded, and a file with no instrumented
additions does not appear. The `Uncovered lines` column lists the post-change
line numbers, collapsed into ranges, that no test executed; open them in
`coverage/index.html` to see the context. Read a low figure here as a list of
places to test, not as a gate — this section does not fail the build.

### Totals

The second section repeats the layer aggregates above, computed from the same
LCOV file, so a global regression is visible next to the patch figure. The
enforced floors remain the `vitest.config.ts` thresholds; the report itself is
informational.

### When the report is missing or partial

- On a `push` to `main` there is no diff base, so the report prints totals only
  and says so.
- For a pull request from a fork the `GITHUB_TOKEN` cannot write comments. The
  comment step is skipped for forks and is `continue-on-error` besides, so a
  failed comment never fails CI; read the report in the job summary instead.
- If the base commit is not in the fetched history, the patch section is skipped
  rather than reported as fully covered.

### Why the comment is published from a separate job

The `build` job checks out and executes pull-request code, so it holds only
`contents: read`. It writes the report to the job summary and uploads the
comment body as an artifact. A second job, `coverage-comment`, holds
`pull-requests: write` and does nothing but download that artifact and post it —
it never checks out the branch or runs repository code, so the write-scoped token
is never exposed to code from the pull request.
