# Security audit: 0.1.0 release

**Date:** 2026-08-10<br>
**Scope:** local index, model and web-provider traffic, downloaded documents, note mutations,
diagnostics, release assets, and npm dependencies.

## Data boundaries

| Boundary                              | Enforced policy                                                                                                                                            | Evidence                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Vault to web search                   | Only the user-entered question is sent. Retrieved chunks, vault paths, and embeddings are excluded.                                                        | `tests/unit/privacy.test.ts`                                                       |
| Model and embedding providers         | Requests go only to the endpoint configured by the user. Local endpoints remain supported for Ollama and LM Studio.                                        | Settings copy and provider configuration                                           |
| Untrusted web/document URLs           | Public HTTP(S) URLs only; credentials, localhost, private/reserved IPv4 and IPv6 literals, and unsafe redirect targets are rejected.                       | `tests/unit/web-url-policy.test.ts`, `tests/unit/download-tools.test.ts`           |
| Note mutations and document downloads | Tools are absent without the explicit mutation permission; downloads additionally require per-action user confirmation before a vault write.               | `tests/unit/research-tool-factory.test.ts`, `tests/unit/download-tools.test.ts`    |
| Logs and diagnostics                  | API-key fields, authorization headers, sensitive URL query parameters, request bodies, and structured error details are redacted before logging or export. | `tests/unit/debug-logger.test.ts`, `tests/unit/diagnostic-report-failures.test.ts` |

## Audit findings and disposition

`npm audit` was run on 2026-08-10. The dependency updates below were applied and must be
validated by the release quality gate:

- `pdfjs-dist` was updated to `6.2.108` to address the arbitrary-JavaScript-execution advisory
  for malicious PDFs.
- `postcss` and `nanoid` were updated to their patched releases.
- `vitest`, `@vitest/coverage-v8`, and `esbuild` were upgraded to remove the remaining Vite
  development-server advisories.

Expected result: `npm audit` reports zero vulnerabilities. Do not release if a new High or
Critical finding appears without a documented reachability assessment, mitigation, owner, and
review date.

## Residual limitations

- URL validation rejects unsafe literals and revalidates redirect targets. DNS rebinding remains
  outside this client-side check because Obsidian resolves the host at request time. Do not add
  arbitrary server-side URL fetching without a DNS-aware request filter.
- A configured chat or embedding provider receives the context needed for that user-initiated
  model request. Users must treat third-party endpoints as data processors.

## Release evidence required

- `npm audit`
- `npm run check`
- `npm run release:check`
- Manual verification that diagnostics and a failed provider request contain no test API key.
- Manual verification that disabled note mutations expose neither mutation nor document-download
  tools.
