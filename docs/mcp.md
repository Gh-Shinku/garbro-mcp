# MCP automation interface

The MCP server is a thin stdio adapter around `@garbro-mcp/core`. Detection, parsing, previews,
selection, and extraction policy remain usable without MCP.

## Filesystem policy

Start the server with named input and output roots:

```text
garbro-mcp-server --input-root games=D:/Games --output-root default=D:/Extracted --output-root music=C:/Users/me/Music
```

Inputs use logical references such as `{ "rootId": "games", "path": "title/data.xp3" }`.
Absolute paths, traversal, unknown root IDs, and symlink escapes are rejected. Every write request
selects an `outputRootId` plus a relative subdirectory. Rejected roots report `allowedRoots`.
The legacy single `--output-root <path>` form remains accepted as `default`. Without arguments,
`workspace` maps to the current directory and output defaults to `garbro-output` below it.

Before connecting a client, run `--version --json` to record the immutable `buildId`, source commit,
format-catalog hash, resource-mapping descriptor hash, and protocol version. `--doctor --json`
validates all configured roots. An
optional `--expected-build-id` makes a stale or different bundle fail at startup.

## Tools

| Tool | Purpose | Writes files |
| --- | --- | --- |
| `get_server_info` | Discover roots, output policy, limits, and capabilities | No |
| `query_resource_mappings` | Query externally supplied, evidence-backed resource mappings | No |
| `search_resources` | Resolve titles through an optional evidence-backed alias catalog | No |
| `list_formats` | Query formats by resource type, status, or extension | No |
| `scan_resources` | Detect supported resources under a logical directory | No |
| `inspect_archive` | Detect and summarize one file | No |
| `list_entries` | Filter and page an archive's entries | No |
| `read_entry` | Return a capped text or hexadecimal preview | No |
| `plan_extraction` | Preflight selection, conflicts, costs, budgets, and plan digest | No |
| `extract_entries` | Extract all, selected IDs, or glob-matched entries | Yes |
| `extract_resources` | Extract several source resources with total budgets | Yes |
| `verify_artifacts` | Hash and structurally verify output artifacts | No |

`scan_resources` uses an opaque cursor and reports failures per file. `list_entries` uses numeric
offset pagination and supports include/exclude globs plus compression and encryption filters.
`read_entry` defaults to a 2 KiB preview, detects UTF-8/UTF-16LE/CP932 text, and falls back to hex
for binary data. Larger previews are opt-in, up to 64 KiB of source bytes, subject to the response budget.

Call `plan_extraction` before a material write. It reports exact known input/output sizes, unknown
sizes, conflicts, budget violations, and a `planDigest` without creating an output directory.
Pass that digest to `extract_entries`; execution rejects `PLAN_CHANGED` if a source or destination
changed after planning. Byte budgets are decimal strings. Available hard bounds are
`maxResources`, `maxInputBytes`, `maxOutputBytes`, `maxDecodedBytesPerResource`, and `timeoutMs`.
Strict output or decoded budgets reject formats whose cost cannot be proven.

`extract_entries` then preflights every selected destination and records each item as
`extracted`, `skipped`, or `failed`. Its conflict policy is `fail`, `skip`, or `overwrite`; overwrite
only replaces regular files. The default destination mirrors the source as
`<outputRoot>/<input rootId>/<source path>.extracted/`. Successful artifacts include the output
root ID, absolute and root-relative paths, byte counts, and SHA-256 hashes. `extract_resources`
preflights all sources and enforces budgets against the aggregate batch before its first write.

`verify_artifacts` reopens only files below configured output roots, computes SHA-256 incrementally,
checks optional expected hashes/sizes, and validates WAV or Ogg structure. Its evidence level is
`hash`, `structural`, or `manifest`; a successful write does not itself imply verified content.

## Resource alias catalogs

Opaque filenames do not contain soundtrack titles. Load user-supplied evidence outside the game
directory with `--resource-catalog <json>` instead of asking the server to guess. Files use schema 1:

```json
{
  "schemaVersion": 1,
  "resources": [{
    "aliases": ["散花"],
    "locale": "ja-JP",
    "locator": {
      "source": { "rootId": "games", "path": "Rewrite/bgm/BGM042.nwa" }
    },
    "metadata": { "title": "Sange", "durationSeconds": 180 },
    "expected": { "sha256": "<64 lowercase hex characters>" }
  }]
}
```

`search_resources` returns `resolved` only for one exact match. Partial or multiple matches are
`ambiguous`; no evidence is `unsupported`. Both include a machine-readable next action.

## Resource mappings and product boundary

garbro-mcp detects, reads, decodes, extracts, and verifies supported resource formats. It does not
reverse-engineer game logic, decompile executables, adapt itself to unknown engines, or infer
character, dialogue, voice, or sprite relationships. An unknown engine may still contain supported
archives and media; use `scan_resources` to discover those formats independently of the engine.

Mappings must come from the user or an external analysis tool. Configure verified JSONL catalogs
with `--resource-mapping-catalog <path>` and user-confirmed JSON or CSV mappings with
`--resource-mapping <path>`; both options are repeatable. A mapping row contains `subjectType`,
`subjectKey`, `predicate`, `resourceType`, `resourcePath`, and optionally `rootId`, `entryId`,
`subjectName`, properties, and `override`. If `rootId` is omitted, the first configured input root
is used.

`query_resource_mappings` can read configured catalogs or a catalog below a named output root. Use
`gameFingerprint` when several configured game catalogs are present. It returns only `verified` and
`user-confirmed` relations by default. Candidate, conflicted, rejected, and unresolved assertions
require an explicit `statuses` filter and must not drive extraction automatically. If no trusted
mapping matches, the tool returns `missing_resource_mapping` and directs the agent to request user
input or perform analysis outside garbro-mcp. It never guesses ownership from filenames.

## Common outcome contract

Every tool result includes `outcome.status`: `ok`, `partial`, `unsupported`, `ambiguous`, or
`failed`. It also contains `warnings`, and when relevant `nextAction` and `verification` evidence.
Existing tool-specific `status` fields remain during the protocol-4 migration. Request failures and
fully failed operations set MCP `isError`; partial batches retain their structured results.

## Context-friendly defaults

The interface exposes thirteen tools without additional prompts or resources. Format lists default
to 20 items; scans and entry lists default to 50. Formats, inspections, and entry lists return
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
`<selected output root>/.garbro-reports/<id>.json`; its `report` artifact includes its root ID,
size, and SHA-256.
If saving fails, `reportError` accompanies the actual extraction counts; completed extraction is
not misreported as unexecuted.

Read report pages through the same tool, without performing extraction again:

```json
{
  "reportPath": ".garbro-reports/<id>.json",
  "outputRootId": "default",
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
