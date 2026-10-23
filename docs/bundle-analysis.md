# Bundle analysis

The production build emits a single CommonJS `main.js` for Obsidian Desktop and
Mobile. Measurements below use the committed lockfile and production minification.

## Measurements

| Metric           |    Before | UTF-8 output |            Change |
| ---------------- | --------: | -----------: | ----------------: |
| `main.js`, bytes | 3,735,184 |    3,523,719 | -211,465 (-5.66%) |
| gzip, bytes      | 1,073,985 |    1,065,212 |   -8,773 (-0.82%) |

esbuild defaults to ASCII output, escaping non-ASCII string contents. Setting
`charset: "utf8"` preserves translated strings directly and reduces the local
artifact size without changing their values. See [esbuild's charset documentation](https://esbuild.github.io/api/#charset).
The gzip result is a comparison of compressed artifacts, not a measured download
or startup time improvement. The bundle budget is now 3,600,000 bytes.

## Largest contributors before optimization

Contributions use esbuild metafile `bytesInOutput`; runtime wrappers account for
the difference between their sum and the complete artifact.

| Contributor                           |     Bytes | Share of `main.js` |
| ------------------------------------- | --------: | -----------------: |
| PDF.js legacy API and worker          | 1,811,729 |              48.5% |
| Plugin source, including translations | 1,387,512 |              37.1% |
| OpenAI SDK                            |   175,316 |               4.7% |
| franc-min                             |   173,788 |               4.7% |
| Anthropic SDK                         |   154,231 |               4.1% |

PDF.js is the largest remaining target. Its dynamic imports are bundled into
`main.js`: this CommonJS build does not split them into separately downloaded
chunks. Splitting requires changes to distribution and loading; the supported
Obsidian release assets are currently `main.js`, `manifest.json`, and `styles.css`.
Replacing the legacy PDF build also requires checking the oldest supported Mobile
WebViews. Those changes need compatibility evidence before adoption.

## Reproduce

```bash
npm ci
npm run build
node esbuild.config.mjs production --analyze
node -e 'const fs = require("node:fs"); const zlib = require("node:zlib"); const bundle = fs.readFileSync("dist/main.js"); console.log({ bytes: bundle.length, gzipBytes: zlib.gzipSync(bundle).length });'
```

The analyzer prints contributions without adding extra release assets. It is
intended for a single build, without `--watch`.

## Download metric

The README badge counts only `main.js` across releases using Shields.io's
[specific asset endpoint](https://shields.io/badges/git-hub-downloads-specific-asset-all-releases).
It approximates installations and updates rather than adding downloads of the
manifest and stylesheet. Retries, direct downloads, and repeated updates can still
increase the count; neither unique users nor successful installations are known.
