# Thinking-prompt evaluation gate

Implements the release gate of §9.4 of
[the specification](../../docs/thinking-prompt-improvement-spec.md).

## Files

- `cases.json` — the nine fixed cases, their repeat counts, expected artefacts and
  behavioural invariants. Each case reproduces an observed defect.
- `baseline.example.json` — the shape of a baseline artefact. A real baseline is measured
  once per (model version × case-set version) and stored beside this file.
- `../../scripts/prompt-eval.mjs` — the evaluator. It reads diagnostic reports
  (`schemaVersion: 4`), computes the metric table, and returns a verdict by metric class.

## Running

```bash
node scripts/prompt-eval.mjs evaluation/thinking-prompt/cases.json <runs-dir> [baseline.json]
```

`<runs-dir>` holds one JSON diagnostic report per run, each carrying the `caseId` of the
case it ran. Exit code 0 means PASS, 1 means a blocking metric fired, 3 means the
baseline is stale and must be re-measured before any comparison.

## Metric classes

| Class            | Metrics                                                   | Effect                                                         |
| ---------------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| must be zero     | extra side effects, destructive overwrites, unknown ids   | any non-zero value blocks, from a single run, no noise band    |
| must not degrade | completion rate, verified citation rate                   | any drop blocks and forces escalation to full repeats          |
| should improve   | rounds, sub-agents, sub-agent search share, artefact size | a drop outside the noise band warns and needs a written reason |

The noise band is measured, not assigned: for each case × metric it is the spread across
the baseline repeats multiplied by 1.5.

## Not yet in place

- **Recorded tool-traffic fixtures.** The blocking gate must run with recorded web
  search, page fetch and remote index responses (§9.4). Recording them needs one live
  session per case; until then the evaluator runs but its verdict is not reproducible.
- **The runner.** Driving the two pinned cloud models needs credentials that are not in
  this repository.
- **A measured baseline.** It cannot exist before the two items above.
- **`R`, the brevity ratio constant.** Per §9.4 it is fixed only from the first
  measurement that shows the brevity rule firing, and only if that ratio is at most 0.8.
- **Language of the answer** has no machine source in the report and stays a manual
  observation, as §9.4 records.
