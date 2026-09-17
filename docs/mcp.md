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
`read_entry` defaults to a 2 KiB preview, detects UTF-8/UTF-16LE/CP932 text, and falls back to hex
for binary data. Larger previews are opt-in, up to 64 KiB of source bytes, subject to the response budget.

`extract_entries` first preflights every selected destination, then records each item as
`extracted`, `skipped`, or `failed`. Its conflict policy is `fail`, `skip`, or `overwrite`; overwrite
only replaces regular files. The default destination mirrors the source as
`<outputRoot>/<rootId>/<source path>.extracted/`. Successful artifacts include absolute and
output-root-relative paths, byte counts, and SHA-256 hashes.

## Context-friendly defaults

The interface still exposes only seven tools, without additional prompts or resources. Format lists
default to 20 items; scans and entry lists default to 50. Formats, inspections, and entry lists return
summaries by default. Set `detail: "full"` only when attribution, implementation notes, checksums,
raw names, or metadata are needed. `list_formats` accepts an exact `formatId` filter; scans reference
formats by ID rather than repeating full descriptors for each file.

Data tools accept `maxResponseBytes`, defaulting to 16 KiB, with a range of 2–64 KiB. This budgets
the serialized tool result, including both structured content and its compatibility text copy, not
just preview source bytes. It is a byte bound, not a token guarantee or a bound on protocol framing.
Pages shrink and return `nextOffset` or `nextCursor`; previews shrink and mark `responseTruncated`.
Always follow the returned continuation rather than adding the requested limit. A single item that
cannot fit fails explicitly instead of being silently skipped. Request a summary or a larger budget.

Extraction returns counts and at most ten failed items by default (`inline: "errors"`). Use
`inline: "summary"` for counts only, or `inline: "all"` for successful artifacts too. `itemLimit`
is capped at 100, and the response budget still applies. `itemsOmitted` and `responseTruncated`
make omitted details explicit. The complete report, including all outcomes and hashes, is saved to
`<outputRoot>/.garbro-reports/<id>.json`; its `report` artifact includes its own size and SHA-256.
If saving fails, `reportError` accompanies the actual extraction counts; completed extraction is
not misreported as unexecuted.

Read report pages through the same tool, without performing extraction again:

```json
{
  "reportPath": ".garbro-reports/<id>.json",
  "inline": "all",
  "offset": 0,
  "itemLimit": 20
}
```

Provide exactly one of `source` (extract) or `reportPath` (read). Follow `nextOffset` using
`reportPath`; offsets index the items selected by `inline`, so keep that mode unchanged between
pages. Report reads reject traversal and symlink paths. Reports remain on disk until the user
removes them. Tool schemas themselves still consume discovery context; these defaults primarily
reduce repeated result payloads, not eliminate the fixed tool-definition cost.

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
paginated and includes reference status and verification level. Supported behavior and known
limitations from `docs/support-status.json` are available with `detail: "full"` under `details`.
Scans now return `formatId`; metadata/raw names/checksums are opt-in. Extraction no longer returns
every outcome inline by default; use the saved report and its pagination for complete results.
