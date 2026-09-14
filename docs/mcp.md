# MCP automation interface

The MCP server is a thin stdio adapter around `@garbro-mcp/core`. Detection, parsing, previews,
selection, and extraction policy remain usable without MCP.

## Filesystem policy

Start the server with one or more named input roots and one output root:

```text
garbro-mcp-server --input-root games=D:/Games --input-root samples=D:/Samples --output-root D:/Extracted
```

Inputs use logical references such as `{ "rootId": "games", "path": "title/data.xp3" }`.
Absolute paths, traversal, unknown root IDs, and symlink escapes are rejected. Extraction is limited
to the configured output root and rejects unsafe archive names and symlinked output components.
Without arguments, `workspace` maps to the current directory and output defaults to
`garbro-output` below it.

## Tools

| Tool | Purpose | Writes files |
| --- | --- | --- |
| `get_server_info` | Discover roots, output policy, limits, and capabilities | No |
| `list_formats` | Query formats by resource type, status, or extension | No |
| `scan_archives` | Detect supported files under a logical directory | No |
| `inspect_archive` | Detect and summarize one file | No |
| `list_entries` | Filter and page an archive's entries | No |
| `read_entry` | Return a capped text or hexadecimal preview | No |
| `extract_entries` | Extract all, selected IDs, or glob-matched entries | Yes |

`scan_archives` uses an opaque cursor and reports failures per file. `list_entries` uses numeric
offset pagination and supports include/exclude globs plus compression and encryption filters.
`read_entry` defaults to a 16 KiB preview, detects UTF-8/UTF-16LE/CP932 text, falls back to hex for
binary data, and never returns more than 64 KiB.

`extract_entries` first preflights every selected destination, then reports each item as
`extracted`, `skipped`, or `failed`. Its conflict policy is `fail`, `skip`, or `overwrite`; overwrite
only replaces regular files. The default destination mirrors the source as
`<outputRoot>/<rootId>/<source path>.extracted/`. Successful artifacts include absolute and
output-root-relative paths, byte counts, and SHA-256 hashes.

Long scans and extractions honor MCP cancellation. When a client supplies a progress token, the
server emits standard `notifications/progress` updates. All byte sizes are decimal strings so they
remain lossless in JSON.

## Migration from the initial interface

This is a breaking MCP surface change:

| Removed tool | Replacement |
| --- | --- |
| `detect_archive` | `inspect_archive` |
| `extract_entry` | `extract_entries` with `selection.mode = "ids"` |
| `extract_archive` | `extract_entries` with `selection.mode = "all"` |

`list_entries` now takes a logical `source` instead of an absolute `archivePath`. `list_formats` is
paginated and includes the generated GARBro reference status, verification level, supported
behavior, and known limitations from `docs/support-status.json`.
