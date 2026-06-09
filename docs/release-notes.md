# Ixplorer Release Notes

## Storage Backend Change

- Ixplorer now uses a vault-local pure JavaScript file-backed vector index instead of LanceDB as the required runtime backend.
- Existing LanceDB-derived index data is not migrated in place because index data is derived from vault files. Users should run `Rebuild` after upgrading from a LanceDB-backed development build.
- The user-facing setting is now `Index folder`; the old persisted `lanceDbFolder` key is still read for compatibility.
- The new index stores `manifest.json`, `sources.jsonl`, shard-local chunk metadata, shard-local `Float32Array` vector files, and lightweight keyword postings locally.
