# Bundle analysis

The production build emits a single CommonJS `main.js` for Obsidian Desktop and
Mobile. Measurements below use the committed lockfile and production minification.

## Measurements

| Metric           |    Before | UTF-8 output | Host PDF runtime | Total reduction |
| ---------------- | --------: | -----------: | ---------------: | --------------: |
| `main.js`, bytes | 3,735,184 |    3,523,719 |        1,705,628 |          54.34% |
| gzip, bytes      | 1,073,985 |    1,065,212 |          494,929 |          53.92% |

esbuild defaults to ASCII output, escaping non-ASCII string contents. Setting
`charset: "utf8"` preserves translated strings directly and reduces the local
artifact size without changing their values. See [esbuild's charset documentation](https://esbuild.github.io/api/#charset).
The gzip result is a comparison of compressed artifacts, not a measured download
or startup time improvement. The bundle budget is now 1,750,000 bytes. The final
artifact also improves on the intermediate UTF-8 build by 51.60%.

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

The plugin now uses Obsidian's public `loadPdfJs()` API instead of bundling a
second PDF.js runtime and worker. The API is documented in the
[official Obsidian declarations](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts).
The host loads its PDF engine on demand and owns worker configuration. The adapter
still copies the input bytes and destroys its document task after success or
failure. No PDF.js runtime is shipped in `main.js`; `pdfjs-dist` remains a
development dependency for real PDF fixture tests through the Obsidian stub.

Release assets remain `main.js`, `manifest.json`, and `styles.css`. This reduces
duplicated plugin code rather than eliminating PDF processing from the application.
The PDF runtime version follows Obsidian. Tests cover the API seam and fixture
extraction; a real-device check on the oldest supported Desktop and Mobile versions
is still needed before release.

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
