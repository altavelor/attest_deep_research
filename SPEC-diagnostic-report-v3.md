# Diagnostic Report v3 — Specification

## Goals

1. **Remove pre-JSON text.** `formatDiagnosticReport` currently prepends human-readable sections ("Diagnostic report", "Context used", etc.) before the raw JSON. v3 is pure JSON — no text prefix.
2. **Logical grouping.** Fields follow the chronological lifecycle of a request.
3. **Actionable findings.** Every report starts with auto-generated findings that name the root cause and say what to fix — not just what happened.
4. **Question visible.** The user's question is part of the report so the data is never detached from the context that produced it.
5. **Score context.** Retrieval scores are presented alongside the threshold that determined whether they were used, so "dropped" chunks have an explanation.
6. **Context utilization.** The token budget shows percentage fill, not just raw numbers.
7. **Per-round agentic trace.** The loop breakdown shows what happened in each individual round, not only totals.
8. **Probe audit trail.** The capability probe records when it ran and what raw results each mode produced, making inconsistent probe results diagnosable.

---

## Top-level shape

```ts
interface DiagnosticReportV3 {
  schemaVersion: 3;
  question:  string;           // user's original question, trimmed (new in v3)
  findings:  FindingsSection;  // root cause summary (new in v3)
  model:     ModelSection;
  preflight: PreflightSection;
  request:   RequestSection;
  reasoning: ReasoningSection;
  answer:    AnswerSection;
  stats:     StatsSection;
}
```

`question` and `findings` appear first so the report is immediately actionable when opened.

---

## 0. `findings` — root cause summary *(new)*

Auto-generated from the rest of the report data. No human input required. Computed deterministically after all other sections are populated.

```ts
interface FindingsSection {
  summary: string;          // one sentence: what happened overall
  findings: Finding[];      // ordered: errors first, then warnings, then info
}

interface Finding {
  severity:        "error" | "warning" | "info";
  code:            string;                   // machine-readable slug
  title:           string;                   // ≤ 80 chars, plain language
  detail:          string;                   // what happened + what to do
  affectedSection: "model" | "preflight" | "request" | "reasoning" | "answer";
  evidence:        Record<string, unknown>;  // the specific values that triggered this
}
```

### Defined finding codes

| Code | Severity | Trigger condition |
|---|---|---|
| `tool-calls-blocked` | error | `model.toolCapabilities.calls === false` |
| `agentic-policy-fallback` | error | `request.agenticPolicy.policyReason !== "eligible"` |
| `mandatory-tool-unsatisfied` | error | `reasoning.agenticLoop` exists and `satisfiedTools` does not contain all `requiredTools` |
| `all-chunks-dropped` | warning | all ranked chunks have `status: "dropped"` |
| `low-retrieval-scores` | warning | `request.retrieval.scoreStats.avg < request.retrieval.scoreStats.threshold` (when threshold known) |
| `index-files-zero-but-chunks-found` | warning | `preflight.index.indexedFiles === 0` and `request.retrieval.rankedChunks.length > 0` |
| `agentic-loop-zero-tool-calls` | warning | `reasoning.agenticLoop.totalCalls === 0` and `reasoning.agenticLoop.totalRounds > 0` |
| `context-near-limit` | warning | `preflight.context.budget.utilizationPct > 90` |
| `probe-inconsistent` | warning | `model.toolCapabilities.probe` exists and its `rawCapabilities.calls` differs from current `model.toolCapabilities.calls` |
| `stream-terminal-missing` | warning | `reasoning.stream.terminalEventObserved === false` |
| `unknown-citations` | info | `answer.unknownCitationIds.length > 0` |
| `index-stale` | info | `preflight.index.isStale === true` |

**Mapping from v2:** not present in v2; entirely new.

---

## 1. `model` — model and chat configuration

```ts
interface ModelSection {
  name:              string;
  apiFormat:         ApiFormat;
  executionStrategy: ResearchExecutionStrategy;
  toolCapabilities: {
    calls:          boolean;
    choiceRequired: boolean;
    choiceSpecific: boolean;
    parallelCalls:  boolean;
    provenance: Record<
      "calls" | "choiceRequired" | "choiceSpecific" | "parallelCalls",
      "format-default" | "probe" | "manual"
    >;
    probe: {                          // audit trail (new in v3)
      ranAt:      string;             // ISO 8601
      modelName:  string;
      apiFormat:  ApiFormat;
      results: {
        required: string[];           // tool names returned for tool_choice: "required"
        specific: string[];           // tool names returned for tool_choice: {type:"specific"}
        auto:     string[];           // tool names returned for tool_choice: "auto"
      };
      rawCapabilities: {              // what probe computed before any manual override
        calls:          boolean;
        choiceRequired: boolean;
        choiceSpecific: boolean;
        parallelCalls:  boolean;
      };
    } | null;
  };
  reasoning: {
    protocol:         ChatApiProtocol;
    capabilitySource: "metadata" | "probe" | "manual" | "observed";
    configuredEffort: string | null;
    summaryRequested: boolean;
    summaryAvailable: boolean;
  } | null;
}
```

**Mapping from v2:**

| v3 path | v2 source |
|---|---|
| `model.name` | not in v2 — add from runtime |
| `model.apiFormat` | not in v2 — add from runtime |
| `model.executionStrategy` | `executionStrategy` |
| `model.toolCapabilities.{calls…parallelCalls}` | capabilities passed at construction |
| `model.toolCapabilities.provenance` | `agentic.capabilityProvenance` |
| `model.toolCapabilities.probe` | new — populated by `probeToolControlCapabilities` |
| `model.reasoning` | `reasoning.{protocol, capabilitySource, configuredEffort, summaryRequested, summaryAvailable}` |

---

## 2. `preflight` — state before the initial request

```ts
interface PreflightSection {
  index: {
    status:       string;
    available:    boolean;
    isStale:      boolean;
    indexedFiles: number;
    errorMessage?: string;
  } | null;
  indexDescription: {
    freshness:               "current" | "stale" | "failed" | "missing";
    textHash:                string;
    algorithmVersion:        number;
    generatedAt:             string;
    indexUpdatedAt:          string;
    representativeChunkCount: number;
    truncated:               boolean;
    usedFallback:            boolean;
    failureReason?:          string;
  } | null;
  context: {
    mode:    ContextMode;
    sources: ContextDiagnosticSource[];  // merged: explicitSources + mentionSources + activeSources
    graph:   ContextGraphDiagnostics;
    budget: {
      limitTokens:         number | null;
      reservedOutputTokens: number | null;
      usedTokens:          number;
      utilizationPct:      number | null;  // usedTokens / limitTokens × 100; null if no limit (new in v3)
      groups:              ContextBudgetGroup[];
    };
  };
  warnings: string[];
}
```

**Mapping from v2:**

| v3 path | v2 source |
|---|---|
| `preflight.index` | `index` |
| `preflight.indexDescription` | `indexDescription` |
| `preflight.context.mode` | `contextMode` |
| `preflight.context.sources` | `explicitSources` + `mentionSources` + `activeSources` merged |
| `preflight.context.graph` | `graph` |
| `preflight.context.budget.{limitTokens…groups}` | `budget` |
| `preflight.context.budget.utilizationPct` | computed: `usedTokens / limitTokens * 100` |
| `preflight.warnings` | `warnings` |

---

## 3. `request` — what was asked and how evidence was found

```ts
interface RequestSection {
  searchMode:    "indexOnly" | "webOnly" | "indexAndWeb" | "none";
  agenticPolicy: {
    policyReason:   string;
    requiredTools:  string[];
    bootstrapChoice: ChatToolChoice;
  };
  retrieval: {
    queryVariants:      string[];
    filteredSourcePaths: string[];
    rankedChunks: Array<{
      id:     string;
      path:   string;
      rank:   number;
      score:  number;
      status: "included" | "dropped" | "filtered";
      reason?: string;
      dropReason?: "budget-overflow" | "score-threshold" | "policy" | "explicit-limit"; // new in v3
    }>;
    includedChunkIds: string[];
    droppedChunkIds:  string[];
    scoreStats: {              // new in v3
      min:       number;
      max:       number;
      avg:       number;
      threshold: number | null;  // score cutoff applied by evidence planner; null if not applicable
    } | null;
  } | null;
  web:            WebContextDiagnostics | null;
  evidencePlanner: EvidencePlannerDiagnostics | null;
}
```

**Mapping from v2:**

| v3 path | v2 source |
|---|---|
| `request.searchMode` | not in v2 — add from runtime |
| `request.agenticPolicy.*` | `agentic.{policyReason, requiredTools}` + `ResearchExecutionPolicy.bootstrapChoice` |
| `request.retrieval.{queryVariants…droppedChunkIds}` | `retrieval` |
| `request.retrieval.rankedChunks[].dropReason` | new — populated by evidence planner |
| `request.retrieval.scoreStats` | new — computed from ranked chunks + evidence planner threshold |
| `request.web` | `web` |
| `request.evidencePlanner` | `evidencePlanner` |

---

## 4. `reasoning` — model generation

```ts
interface ReasoningSection {
  attempts: Array<{
    attempt:          number;
    protocol:         ChatApiProtocol;
    status:           "completed" | "failed" | "cancelled";
    outputEmitted:    boolean;
    errorCode?:       string;
    fallbackDecision?: string;
  }>;
  stream: {
    protocol:               ChatApiProtocol;
    protocolSource:         "profile" | "cache" | "probe" | "fallback";
    observedDialects:       string[];
    frameCount:             number;
    malformedFrameCount:    number;
    ignoredEventCount:      number;
    reasoningDeltaCount:    number;
    textDeltaCount:         number;
    toolDeltaCount:         number;
    terminalEventObserved:  boolean;
    doneMarkerObserved:     boolean;
    warnings:               string[];
    firstByteMs?:           number;
    firstReasoningMs?:      number;
  } | null;
  agenticLoop: {
    totalRounds:    number;
    totalCalls:     number;
    duplicateCalls: number;
    satisfiedTools: string[];
    repairedTools:  string[];
    fallbackReason?: string;
    stopReasons:    string[];
    budgets: {
      maxRounds:      number;
      maxCallsPerRound: number;
      maxTotalCalls:  number;
      maxResultChars: number;
      usedResultChars: number;
    } | null;
    rounds: Array<{                              // new in v3: per-round breakdown
      round:          number;
      phase:          "bootstrap" | "repair" | "research";
      toolCalls:      ToolCallDiagnostic[];      // calls made in this specific round
      hadTextOutput:  boolean;                   // model produced text (not just tool calls)
      classification: "intermediate" | "final" | "discarded" | null;
    }>;
  } | null;
  tokens: {
    inputTokens:    number;
    outputTokens:   number;
    reasoningTokens: number;
  };
  reasoningItemCount:  number;
  continuationRounds:  number;
}
```

**Mapping from v2:**

| v3 path | v2 source |
|---|---|
| `reasoning.attempts` | `attempts` |
| `reasoning.stream` | `stream` |
| `reasoning.agenticLoop.totalRounds` | `agentic.rounds` |
| `reasoning.agenticLoop.totalCalls` | `agentic.totalCalls` |
| `reasoning.agenticLoop.duplicateCalls` | `agentic.duplicateCalls` |
| `reasoning.agenticLoop.satisfiedTools` | `agentic.satisfiedTools` |
| `reasoning.agenticLoop.repairedTools` | `agentic.repairedTools` |
| `reasoning.agenticLoop.fallbackReason` | `agentic.fallbackReason` |
| `reasoning.agenticLoop.stopReasons` | `agentic.stopReasons` |
| `reasoning.agenticLoop.budgets` | `agentic.budgets` |
| `reasoning.agenticLoop.rounds` | new — `AgenticResearchRunner` emits per-round data |
| `reasoning.tokens` | `reasoning.{inputTokens, outputTokens, reasoningTokens}` |
| `reasoning.reasoningItemCount` | `reasoning.reasoningItemCount` |
| `reasoning.continuationRounds` | `reasoning.continuationRounds` |

> **Implementation note.** `AgenticResearchRunner` already tracks `phases` as a flat array indexed by round. The per-round `rounds` array is built from existing data: `phases[i]` → `round.phase`; tool calls are already tagged with `round` in `ToolCallDiagnostic`; `onRoundClassified` provides `classification`. No new data is generated — only structured differently.

---

## 5. `answer` — post-generation

```ts
interface AnswerSection {
  projection: {
    reasoningSegments:      number;
    checkpointsCreated:     number;
    finalAnswersCommitted:  number;
    bufferedTextChars:      number;
    staleEventsIgnored:     number;
    duplicateDeltasIgnored: number;
    classifications: Array<{
      round:          number;
      classification: "intermediate" | "final" | "discarded";
      reason:         string;
    }>;
  } | null;
  delivery: {
    projectorEventsReceived: number;
    uiPatchesApplied:        number;
    coalescedUpdates:        number;
    markdownRenders:         number;
    staleRunEventsIgnored:   number;
    persistenceStatus:       "not-requested" | "saved" | "failed";
    reloadRestored?:         boolean;
  } | null;
  unknownCitationIds: string[];
}
```

**Mapping from v2:** unchanged; `answer.unknownCitationIds` ← `agentic.unknownCitationIds`.

---

## 6. `stats` — run lifecycle

```ts
interface StatsSection {
  runId:         string;
  answerId:      string;
  status:        "completed" | "failed" | "cancelled" | "replaced";
  startedAt:     string;   // ISO 8601
  durationMs:    number;
  lastPhase:     string;
  terminalReason?: string;
  timeline: Array<{
    offsetMs: number;
    type:     string;
    round?:   number;
    status?:  string;
    reason?:  string;
  }>;
  omittedTimelineEvents?: number;
}
```

**Mapping from v2:** `stats.*` ← `run.*`.

---

## Fields removed in v3

| v2 field | Reason |
|---|---|
| `reportSchemaVersion` | replaced by top-level `schemaVersion: 3` |
| `agentic.duplicatedCost` | derivable from `reasoning.agenticLoop.fallbackReason !== undefined` |
| `agentic.capabilityProvenance` | moved to `model.toolCapabilities.provenance` |
| `agentic.phases` (flat array) | replaced by `reasoning.agenticLoop.rounds[].phase` |
| top-level `tools` (flat array) | moved to `reasoning.agenticLoop.rounds[].toolCalls` |

---

## Output format

`formatDiagnosticReport` (v2) returns a string with text prefix + JSON. v3 returns only `JSON.stringify(report, null, 2)` — no prefix.

```
// v2
"Diagnostic report\n\nContext used\n...\n\nDebug details\n{...}"

// v3
"{...}"
```

---

## HTML report

### Input

`formatDiagnosticReportHtml(diagnostics: ContextDiagnostics): string`

Accepts the v3 `ContextDiagnostics` shape directly. `DiagnosticReportViewModel` is retained only for the in-app readable panel.

### Page structure

```
<nav>                 sticky top bar: brand · "Diagnostic report" · section anchors
<header>              question + run identity
<section findings>    root cause summary  (omitted if findings array is empty)
<section model>
<section preflight>
<section request>
<section reasoning>
<section answer>
<section timeline>
<section warnings>    (omitted if warnings array is empty)
```

Order matches the v3 JSON schema. Each section is a self-contained card.

---

### Section contents

#### `<header>` — question + run identity

- **Question** displayed prominently below the eyebrow, in regular (non-monospace) text, at ≥ 16 px
- Run ID · Answer ID in monospace (muted)
- Status badge: `completed` → success, `failed` → danger, other → neutral
- Execution strategy badge: `agentic` → accent, `deterministic-fallback` → neutral
- Meta row: started at, duration, last phase
- Second meta row if agentic present: policy reason `code`, fallback reason badge, required tools tags, satisfied tools tags (success colour)

#### `<section findings>` *(new)*

Only rendered when `findings.findings.length > 0`.

- `findings.summary` in larger text at top of section
- Each finding as a bordered block:
  - Left accent stripe: red (error), amber (warning), blue (info)
  - Title bold, detail below in muted
  - `affectedSection` tag flush right
  - `evidence` values as inline `<code>` chips within the detail text
- Findings sorted: errors → warnings → info

#### `<section model>`

- Definition list: model name, API format, execution strategy, reasoning protocol, capability source, configured effort, summary requested/available
- **Tool capabilities** sub-table: 4 rows (calls / choiceRequired / choiceSpecific / parallelCalls)
  - Columns: flag, value (yes/no badge), provenance badge
- **Probe audit** block (if `toolCapabilities.probe` present):
  - Ran at, model, API format
  - Results table: mode (`required` / `specific` / `auto`), tools returned (comma-separated or "none")
  - "Raw capabilities" before manual override as inline badges
  - If `probe.rawCapabilities` differs from current `toolCapabilities`, show warning callout: "Probe result was overridden by manual settings"

#### `<section preflight>`

- **Index**: status, available, stale, indexed files; error message in danger callout if present
- **Index description** (if present): freshness badge, algorithm version, chunk count, generated at, truncated yes/no
- **Context sources** table (if non-empty): path (monospace, max 60 chars + …), role tag, status badge, included tokens
- **Token budget**:
  - Utilization bar: filled portion = `utilizationPct`%; colour: green < 75%, amber 75–90%, red > 90%
  - Label: `N / M tokens (P%)` where M is `limitTokens`, P is `utilizationPct`
  - Groups table: name, used tokens, allocated tokens, included items, dropped items

#### `<section request>`

- **Agentic policy**: policy reason in monospace, bootstrap choice type, required tools as tags, phases as `→` chain
- **Query variants**: numbered list
- **Ranked chunks** table:
  - Columns: rank, ID (12 chars + …), path, score, threshold comparison, status + drop reason
  - "Score vs threshold" column: show score in colour relative to threshold — green if above, red if below; show threshold value in muted parentheses. If threshold unknown, show score only.
  - `dropReason` rendered as a small tag beside the status badge
- **Score statistics** (if `scoreStats` present): min / avg / max scores on one line, threshold shown with a separator; if avg < threshold, show warning callout: "Average score below threshold — retrieval may have poor coverage"
- **Evidence planner**: policy badge, evidence limit, web intent detected (yes/no + reason), local quality weak (yes/no + reasons list), dropped counts table (explicit / graph / retrieval / web)
- **Web search** (if present): query strategy, queries list, result summary (N included / M dropped of total), prompt tokens

#### `<section reasoning>`

- **Stream**: protocol, source, dialect tags, delta counts (reasoning Δ / text Δ / tool Δ), terminal event badge, first byte / first reasoning ms; stream warnings in warning callout
- **Agentic loop** (if present):
  - Totals: rounds, calls, duplicates, budget fractions (`used/max` for rounds, calls, result chars)
  - **Per-round breakdown** table (new):
    - Columns: round #, phase badge, tool calls count, text output (yes/no), classification badge
    - Each row is expandable: clicking shows tool calls for that round inline (tool name, status badge, result bytes, args preview)
  - Satisfied / repaired tools as tag lists; fallback reason as danger badge if present
- **Tokens**: input / output / reasoning on one row; reasoning items and continuation rounds below

#### `<section answer>`

- **Projection**: reasoning segments, checkpoints created, final commits, stale events ignored, duplicate deltas ignored; classifications table (round, classification, reason) if non-empty
- **Delivery**: projector events, UI patches, markdown renders, persistence status badge
- **Unknown citations** (if any): danger callout listing IDs as `<code>` chips

#### `<section timeline>`

- Table: offset (ms), event type, detail (status · reason)
- Consecutive identical types with no detail collapsed into one row with ×N badge
- `omittedTimelineEvents` note below table if > 0

#### `<section warnings>`

- Unordered list, warning colour; omitted if `warnings` is empty

---

### Visual design

#### Palette

| Token | Light | Dark |
|---|---|---|
| `--dr-bg` | `#f9f8f6` | `#111110` |
| `--dr-surface` | `#ffffff` | `#1c1b19` |
| `--dr-surface-2` | `#f3f2ef` | `#242320` |
| `--dr-text` | `#1c1917` | `#e8e4df` |
| `--dr-muted` | `#78716c` | `#9c9791` |
| `--dr-border` | `#e7e5e0` | `#2e2c28` |
| `--dr-border-2` | `#d6d3ce` | `#3d3a35` |
| `--dr-accent` | `#cc5200` | `#f97316` |
| `--dr-accent-bg` | `#fff4ef` | `#1c1007` |
| `--dr-success` | `#166534` | `#4ade80` |
| `--dr-success-bg` | `#f0fdf4` | `#052e16` |
| `--dr-success-border` | `#bbf7d0` | `#14532d` |
| `--dr-warning` | `#92400e` | `#fbbf24` |
| `--dr-warning-bg` | `#fffbeb` | `#1c1000` |
| `--dr-warning-border` | `#fde68a` | `#451a03` |
| `--dr-danger` | `#991b1b` | `#f87171` |
| `--dr-danger-bg` | `#fef2f2` | `#1c0606` |
| `--dr-danger-border` | `#fecaca` | `#450a0a` |
| `--dr-neutral-bg` | `#f3f4f6` | `#1f2937` |
| `--dr-neutral-text` | `#374151` | `#d1d5db` |

Dark mode via `@media (prefers-color-scheme: dark)`.

#### Typography

- Body: `'Inter', system-ui, -apple-system, sans-serif` — 14 px / 1.6
- Monospace: `'JetBrains Mono', 'Fira Code', ui-monospace, monospace` — 12 px
- Question text: 17 px, font-weight 500
- Section title (card eyebrow): 13 px, 600, uppercase, letter-spacing 0.05 em, muted

#### Components

| Component | Description |
|---|---|
| **Badge** (pill, border) | status, strategy, policy, severity, provenance |
| **Tag** (rounded rect, muted fill) | tool names, roles, phases, drop reasons |
| **Callout** (left stripe + tinted bg) | findings, warnings, probe inconsistency alerts |
| **Card** | each section; eyebrow strip in `--dr-surface-2`, body below |
| **Definition list** | 2-column grid, label 160–220 px, muted |
| **Data table** | multi-column; sticky header in `--dr-surface-2` |
| **Utilization bar** | single `<div>` with filled child; colour by threshold |
| **Score chip** | inline score value, colour-coded against threshold |
| **Pre block** | args JSON and result preview; horizontal scroll |
| **Nav bar** | sticky, 48 px, brand · label · anchors flush right |

#### Spacing

- Layout max width: 960 px, centered
- Card gap: 16 px
- Card body padding: 20 px 24 px
- Sub-heading `h4`: 12 px, uppercase, muted, 20 px top margin (0 if first child)
- Definition list row: 7 px 0, border-bottom between rows

#### Badge variants

| Variant | Background | Text | Border |
|---|---|---|---|
| `success` | `--dr-success-bg` | `--dr-success` | `--dr-success-border` |
| `warning` | `--dr-warning-bg` | `--dr-warning` | `--dr-warning-border` |
| `danger` | `--dr-danger-bg` | `--dr-danger` | `--dr-danger-border` |
| `accent` | `--dr-accent-bg` | `--dr-accent` | 30% accent tint |
| `neutral` | `--dr-neutral-bg` | `--dr-neutral-text` | `--dr-border` |

---

### Constraints

- **No external resources.** No `src=`, `href=http`, `@import`, or web fonts via URL. All CSS inlined. Font stack falls back entirely to system fonts.
- **No `<script>`.** No executable JavaScript. "Expandable" per-round rows are implemented with `<details>`/`<summary>` only.
- **Escape all user data.** All string values from `ContextDiagnostics` are HTML-escaped. Attribute values use a restricted character allowlist (`[a-zA-Z0-9_-]`).
- **Print-friendly.** `@media print`: nav hidden, shadows removed, cards `break-inside: avoid`, `<details>` forced open.
- **Self-contained single file.** One `.html` file, no external dependencies.
