# Mobile release checklist

## Status

This checklist has **not been executed** for the current change. Automated tests cannot validate
Capacitor/WebView lifecycle, the software keyboard, OS link handling, or device memory pressure.
Do not mark mobile release validation complete until every required iOS and Android row has device,
OS, Obsidian version, date, and tester evidence recorded.

## Test matrix

| Platform | Device | OS version | Obsidian version | Result    | Date/tester |
| -------- | ------ | ---------- | ---------------- | --------- | ----------- |
| iOS      | TBD    | TBD        | TBD              | ☐ Not run | TBD         |
| Android  | TBD    | TBD        | TBD              | ☐ Not run | TBD         |

Repeat the checklist on both rows.

## Installation and lifecycle

- [ ] Install the release assets into a clean mobile vault and enable Attest without a load error.
- [ ] Restart Obsidian; confirm settings, saved chats, and the selected index profile persist.
- [ ] Disable and re-enable Attest while its chat view is open; confirm no stale UI or duplicate
      listeners remain.
- [ ] Disable Attest during an active answer; confirm the request stops and no late response or
      notice appears after unload.
- [ ] Background and foreground the app during chat and indexing; confirm documented pause,
      resume, cancellation, and timeout behavior.

## Providers and network

- [ ] Configure a CORS-capable cloud provider and run model discovery/capability checks.
- [ ] Receive a streaming cloud answer and stop it before completion.
- [ ] Exercise a timeout and an offline/network-loss failure; confirm each leaves the UI usable.
- [ ] Select Ollama or a loopback OpenAI-compatible endpoint; confirm the immediate mobile-specific
      error instead of a network timeout.
- [ ] If a cloud endpoint lacks streaming CORS headers, confirm the limitation is clear and no
      successful connection-test result is presented as proof that streaming will work.

## Synced index and documents

- [ ] Build an index on desktop, sync its configured relative folder and Attest settings, wait for
      sync completion, then retrieve and open a cited vault note on mobile.
- [ ] Confirm the mobile rebuild action requires explicit confirmation.
- [ ] Run a small incremental mobile update and confirm the desktop-built index remains readable.
- [ ] Open Markdown, PDF, and supported document citations; verify missing or renamed files fail
      safely.
- [ ] Try a PDF above the documented mobile limit and confirm it is rejected without exhausting the
      app.

## Responsive, touch, and keyboard UI

- [ ] Exercise chat, history, settings profile rows, index panels, context picker, diagnostics, and
      image lightbox in portrait and landscape.
- [ ] Verify toolbar, message, citation, history, modal, and settings actions can be activated by
      touch without relying on hover.
- [ ] Open the software keyboard in the composer, settings inputs, history search, and rename field;
      confirm focused controls remain visible and content can still scroll.
- [ ] Rotate with the keyboard open; confirm popovers and modals stay inside the visible viewport.
- [ ] Test long vault paths, model names, URLs, RTL text, and large system font settings for clipping
      or horizontal page overflow.
- [ ] Open an HTTP(S) web citation and confirm the OS/Obsidian external-link flow opens exactly once;
      confirm vault citations still open inside Obsidian.

## Evidence required before release

- [ ] Record the completed matrix values above.
- [ ] Attach screenshots for narrow settings, keyboard-open chat, history, diagnostics, and lightbox.
- [ ] Record logs for cancellation, background/foreground, timeout, and rejected local-provider
      scenarios with secrets and private note content removed.
- [ ] File issues for every failure and link the resolved issue or accepted limitation here.
