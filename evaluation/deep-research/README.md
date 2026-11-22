# Deep Research evaluation baseline

The baseline that later Deep Research slices are measured against. It follows the layout of
[`../thinking-prompt/`](../thinking-prompt/README.md).

## Files

- `corpus/` — a small frozen vault about a fictional reservoir upgrade. Do not edit it
  without bumping `caseSetVersion`: the corpus hash is part of every result.
- `cases.json` — twelve frozen cases in three groups of four:
  - `multi-facet`: the answer needs three or more independent notes;
  - `conflict`: two notes disagree on a date, number or scope, and the gold answer names it;
  - `disconfirmation`: an attractive claim is contradicted by one passage.

  Each case stores the question, its objectives (markers plus gold `evidence` passages),
  the `contradicting` passages and its `conflicts`. The top-level `syndicates` list holds
  the copies of the press release that count as one source.

- `runner.config.json` — the modes and the two model profiles (`local`, `remote`).
- `baseline.example.json` — the shape of a result file. Real results are stored as
  `baselines/<mode>-<profile>.json`.
- `../../scripts/deep-research-eval.mjs` — the scorer and result writer.

## Recording a baseline

1. Index `corpus/` as a vault and ask each case question once per declared repeat, in the
   given mode, with the given profile.
2. Store one JSON file per run in a runs directory:
   `{ "caseId", "mode", "profile", "modelVersion", "promptHash", "policyHash",
"answer": { "text", "claims": [{ "objective", "text", "certainty": "asserted" | "hedged",
"citations": [{ "path", "excerpt" }] }] }, "cost": { "rounds", "searches", "tokens", "activeMs" } }`.
   Claims are the material claims of the answer, annotated by a reviewer or a judge; an
   excerpt is the cited passage text.
3. Run, in one command:

```bash
node scripts/deep-research-eval.mjs evaluation/deep-research/runner.config.json \
  --mode thinking --profile local --runs <runs-dir> \
  --out evaluation/deep-research/baselines/thinking-local.json
```

Exit code 0 means written and complete, 1 means written but some case is short of its
repeats (listed under `missing`), 2 is a usage error, 4 means the scorer failed its own
self-check and nothing was written.

## Metrics

| Metric                       | Meaning                                                              |
| ---------------------------- | -------------------------------------------------------------------- |
| `objectiveCoverage`          | share of objectives stated with their markers and a supporting cite  |
| `citationSupport`            | share of citations whose excerpt contains a gold passage of its note |
| `unreportedConflicts`        | conflicts whose markers the answer text does not all name            |
| `copiedSourcesAsIndependent` | claims citing two or more copies from one syndicate                  |
| `unsupportedCertainty`       | claims not marked `hedged` that carry no supporting citation         |
| `rounds`, `searches`, …      | cost as reported by the run; absent fields stay `null`               |

A metric that cannot be computed is `null` (unavailable), never zero. Fingerprints that a
run does not report are `"unavailable"`.

Before scoring, the scorer checks itself: every gold passage must occur in the corpus, a
positive control (the gold answer) must score full coverage and support, and a negative
control (confident claims citing only note headings) must score zero support.

## Not yet in place

- **Recorded Thinking baselines.** Collecting runs needs the plugin driven against the
  corpus with both profiles; no remote credentials are available in this repository, so
  `baselines/` is empty until the first measured run.
- **Live web runs** are a separate, non-reproducible set and never gate a release.
