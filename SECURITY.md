# Security Policy

## Supported versions

Only the latest released version of Attest receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
| < 0.1.0 | No        |

## Reporting a vulnerability

Report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/altavelor/attest_deep_research/security/advisories/new).
If you cannot use that channel, email <pstrabery@gmail.com> with the subject `Attest security`.

Do not open a public issue or pull request for a suspected vulnerability.

Please include:

- affected version (`manifest.json` version) and Obsidian version;
- operating system;
- configured providers (local or cloud) without any credentials;
- reproduction steps and observed impact.

You can expect an acknowledgement within 7 days and a status update within 30 days. Fixed issues are
credited in `CHANGELOG.md` unless you ask otherwise.

## Scope

In scope:

- leaking API keys or vault content into diagnostics, logs, notices, saved notes, or outbound
  requests;
- sending vault content to an external endpoint without an explicit user action;
- path traversal or unintended writes outside the vault;
- requests to private or local network targets that bypass URL validation;
- unsafe handling of untrusted document, web page, or model output.

Out of scope:

- vulnerabilities in Obsidian itself, in a model provider, or in a web source;
- risks that follow directly from a configuration the user chose knowingly, such as pointing the
  plugin at an untrusted endpoint or enabling note mutations;
- findings that require an already compromised machine or vault.

## Handling secrets and vault data

- API keys are stored in Obsidian plugin settings on the local machine and are never written to
  diagnostic reports, logs, or saved answers.
- Vault content, embeddings, and index files stay on disk; they are sent only to the chat and
  embedding endpoints the user configures.
- Web search is disabled by default and receives only the query the user typed.
- Never attach raw API keys or private notes to an issue or advisory; redact them first.
