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

Non-regression thresholds are enabled for every layer, aggregated per glob,
never per file. Each value sits a few points below the measured
baseline so unrelated refactors do not fail CI on rounding, while a real drop in
exercised behaviour does.

| Glob                 | Statements | Branches | Functions | Lines |
| -------------------- | ---------- | -------- | --------- | ----- |
| `src/core/**`        | 90         | 86       | 90        | 90    |
| `src/application/**` | 86         | 82       | 86        | 86    |
| `src/adapters/**`    | 84         | 79       | 84        | 84    |
| `src/apps/**`        | 58         | 73       | 48        | 58    |

The branch floors were raised by issue #30 once the cancellation, untrusted-input,
and UI failure-path tests landed; see Failure-path coverage below for the
measured values each floor sits under. Statement, function, and line floors are
unchanged for the three inward layers: that work targeted branches, and leaving
the other floors where they were keeps the gate on the axis the tests moved.

`src/apps` is thresholded for the first time. Its floors sit two to three points
below measurement rather than the wider margin used inward, because `src/apps`
moves in larger steps: exercising one more view adds both covered statements and
undiscovered nested functions. The function floor of 48 is the loosest of the
four for that reason.

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

## Current figures

Measured on the merged tree once every issue #30 test suite had landed. This
table supersedes every table above, which are kept as the record of where the
work started.

| Scope             | Statements | Branches | Functions | Lines  |
| ----------------- | ---------- | -------- | --------- | ------ |
| total             | 82.20%     | 82.17%   | 76.44%    | 82.20% |
| `src/core`        | 95.68%     | 88.24%   | 95.96%    | 95.68% |
| `src/application` | 90.40%     | 83.82%   | 90.00%    | 90.40% |
| `src/adapters`    | 88.63%     | 81.83%   | 85.62%    | 88.63% |
| `src/apps`        | 60.65%     | 75.72%   | 50.00%    | 60.65% |
| `src/shared`      | 95.40%     | 91.80%   | 100.00%   | 95.40% |

### After issue #18

| Scope             | Statements | Branches | Functions | Lines  |
| ----------------- | ---------- | -------- | --------- | ------ |
| total             | 80.67%     | 80.00%   | 75.86%    | 80.67% |
| `src/core`        | 95.13%     | 87.31%   | 95.96%    | 95.13% |
| `src/application` | 90.06%     | 83.09%   | 89.70%    | 90.06% |
| `src/adapters`    | 88.02%     | 79.76%   | 85.53%    | 88.02% |
| `src/apps`        | 56.90%     | 69.83%   | 48.43%    | 56.90% |
| `src/shared`      | 95.40%     | 91.53%   | 100.00%   | 95.40% |

`src/apps` rose from the 20.95% baseline to 56.90%. The function percentage of
`src/apps` and of the total fell even as statements rose: V8 only discovers a
module's nested functions once that module executes, so exercising the chat,
composer, and settings modules added far more functions to the denominator than
the tests call directly. Read the statement and branch columns for progress here.

## Failure-path coverage (issue #30)

Statement coverage had run ahead of branch coverage by 8 to 16 points, and the
gap sat on exactly one kind of code: error handling, cancellation, and malformed
external input. Four test suites closed it, and the source-text contracts that
had stood in for behaviour were replaced by executable DOM tests — one of them
was green only because an unfinished removal had left `IndexControl.ts`,
`ModelDropdown.ts`, and the `showChatIndexControl` setting unreachable. Those
were deleted; a settings file that still carries the field loads and ignores it.

Branch coverage of the files the issue named, before and after:

| File                                        | Before | After  |
| ------------------------------------------- | ------ | ------ |
| `settings/responsesCapabilityProbe.ts`      | 41.7%  | 68.25% |
| `core/agent/AgentLoop.ts`                   | 65.1%  | 89.55% |
| `research/sub-agent/SubAgentRunner.ts`      | 48.1%  | 75.60% |
| `strategies/ThinkingResearchStrategy.ts`    | 65.0%  | 66.66% |
| `research-tools/index/IndexResearchTool.ts` | 36.1%  | 66.0%  |
| `web/images/OpenverseImageSource.ts`        | 51.6%  | 70.3%  |
| `web/images/WikimediaCommonsImageSource.ts` | 62.5%  | 68.8%  |
| `web/sources/serpSources.ts`                | 63.6%  | 100%   |
| `web/sources/neuralSources.ts`              | 62.5%  | 100%   |
| `indexing/store/FileVectorIndexFormat.ts`   | 67.2%  | 80.2%  |
| `chat/providers/messageMappers.ts`          | 60.7%  | 97.2%  |

### Why the thresholds sit where they do

Each floor is set at the largest round value that stays under the measured
figure with room for the rounding a refactor causes, so a real loss of exercised
behaviour fails CI and an unrelated change does not:

| Glob                 | Branch floor | Measured | Margin |
| -------------------- | ------------ | -------- | ------ |
| `src/core/**`        | 86           | 88.24%   | 2.24   |
| `src/application/**` | 82           | 83.82%   | 1.82   |
| `src/adapters/**`    | 79           | 81.83%   | 2.83   |
| `src/apps/**`        | 73           | 75.72%   | 2.72   |

`src/apps` statements are floored at 58 against a measured 60.65%, functions at
48 against 50.00%. The function margin is deliberately the widest in relative
terms: V8 discovers a module's nested functions only once that module executes,
so a test that exercises one more view can lower the function percentage while
raising every other column.

The residual uncovered branches are not failure paths. What remains in the image
sources is licence and attribution formatting; in `ThinkingResearchStrategy` it
is optional dependencies — context assembler, note tools, document search,
persistence, nested sub-agents — whose own paths are covered where they live.

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

## Settings prober and plugin lifecycle (issue #18, `src/apps`)

`tests/unit/ui/settings-prober.behaviour.test.ts` and
`tests/unit/ui/plugin-lifecycle.behaviour.test.ts` execute the settings tab and
the plugin entry point against the Obsidian stub, with the capability probes
mocked so no test reaches the network.

| File                                                    | Statements before | Statements after |
| ------------------------------------------------------- | ----------------- | ---------------- |
| `apps/obsidian/main.ts`                                 | 0.00%             | 47.16%           |
| `apps/obsidian/ui/settings/SettingsCapabilityProber.ts` | 0.00%             | 36.88%           |
| `apps/obsidian/ui/SettingsTab.ts`                       | 0.00%             | 84.21%           |
| `src/apps` aggregate                                    | 20.95%            | 47.67%           |

## Composer and research-controller behaviour (issue #18)

`tests/unit/ui/chat-composer.behaviour.test.ts` and
`tests/unit/ui/research-question-controller.behaviour.test.ts` execute the chat
composer and the research question controller under happy-dom with fake timers,
replacing source-text claims with assertions on rendered DOM state and on the
order of the render callbacks a stream triggers. Statement coverage of the three
files, measured with `npm run test:coverage`:

| File                                                 | Before   | After         |
| ---------------------------------------------------- | -------- | ------------- |
| `apps/obsidian/ui/chat/ChatComposer.ts`              | 0/413 0% | 353/413 85.5% |
| `apps/obsidian/ui/chat/ChatComposerController.ts`    | 0/224 0% | 186/224 83.0% |
| `.../ui/chat/research/ResearchQuestionController.ts` | 0/482 0% | 353/482 73.2% |

Measured alone against the 20.95% baseline these tests take `src/apps` to 28.71%
statements. Together with the settings-prober and plugin-lifecycle tests above,
`src/apps` now stands at 50.10% statements and 67.53% branches.

## Chat view and retired static contracts (issue #18)

`IxplorerChatView` is now opened through the stub `WorkspaceLeaf`, so panel
selection under debug mode and transcript disposal on close and on redisplay are
executed rather than described. The two remaining behavioural source-text
assertions were replaced by executable tests: the fetch-target animation
(advance under fake timers, `disposeChatTranscript` cancels the pending timer)
and the index path picker (`scrollTop` after a selection-triggered rerender).
`tests/arch/` now holds static policy only — CSS classes, removed controls,
import boundaries, schema shape, and the comment policy; the executable
tool-presentation catalog test moved to `tests/unit/`.

`src/apps` measured with `npm run test:coverage` on the same commit, before and
after these tests:

| Scope      | Statements    | Branches      | Functions     | Lines         |
| ---------- | ------------- | ------------- | ------------- | ------------- |
| `src/apps` | 20.95 → 40.58 | 58.77 → 65.02 | 57.03 → 49.49 | 20.95 → 40.58 |

Those are the figures for these tests alone. With the settings-prober,
plugin-lifecycle, composer, and research-controller tests above, `src/apps`
reaches 56.90% statements and 69.83% branches — see Current figures.

The function percentage falls while the statement percentage doubles because V8
only discovers the nested functions of a module once that module executes: the
newly exercised chat, composer, and settings modules add far more functions to
the denominator than the tests call directly.
