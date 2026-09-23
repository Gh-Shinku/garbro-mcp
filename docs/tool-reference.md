# garbro-mcp Tool Reference

- **[Discovery](#discovery)** (5 tools)
  - [`get_server_info`](#get_server_info)
  - [`list_formats`](#list_formats)
  - [`scan_resources`](#scan_resources)
  - [`inspect_archive`](#inspect_archive)
  - [`list_entries`](#list_entries)
- **[Extraction](#extraction)** (3 tools)
  - [`plan_extraction`](#plan_extraction)
  - [`extract_entries`](#extract_entries)
  - [`extract_resources`](#extract_resources)
- **[Background extraction](#background-extraction)** (3 tools)
  - [`start_extraction`](#start_extraction)
  - [`get_extraction_status`](#get_extraction_status)
  - [`cancel_extraction`](#cancel_extraction)
- **[Verification](#verification)** (1 tool)
  - [`verify_artifacts`](#verify_artifacts)

## Common values

An input `source` is a logical path below a configured input root:

```json
{ "rootId": "games", "path": "Rewrite/voice.xp3" }
```

Absolute paths and paths that escape the selected root are rejected. Byte counts and byte budgets
are decimal strings so they remain lossless in JSON.

Most data-returning tools accept `maxResponseBytes`. It defaults to 16384 and accepts 2048 through
65536. A response may contain `nextOffset`, `nextCursor`, `itemsOmitted`, or `responseTruncated` when
the complete result does not fit.

Extraction selections have one of these shapes:

- `{"mode":"all"}` selects every matching entry. `excludeGlobs` and `resourceTypes` are optional.
- `{"mode":"ids","entryIds":["0","1"]}` selects explicit entry IDs. `resourceTypes` is optional.
- `{"mode":"glob","includeGlobs":["voice/**/*.ogg"]}` selects by path. `excludeGlobs`,
  `caseSensitive`, and `resourceTypes` are optional.

Entry resource types are `audio`, `image`, `script`, and `unknown`. Classification uses explicit
format metadata or recognized filename extensions. It does not infer character, dialogue, or other
semantic ownership.

Extraction budgets may contain:

- `maxResources` (number): Maximum selected entries.
- `maxInputBytes` (decimal string): Maximum packed input bytes.
- `maxOutputBytes` (decimal string): Maximum known extracted bytes.
- `maxDecodedBytesPerResource` (decimal string): Maximum decoded bytes for one entry.
- `timeoutMs` (number): Timeout from 1 to 3600000 milliseconds.

Every tool result includes an `outcome` with `status`, warnings, and an actionable next step when
appropriate. Request failures set MCP `isError`. Batch operations may return `partial` without
setting `isError`; callers must inspect `hasFailures` and per-item status.

---

## Discovery

### `get_server_info`

**Description:** Returns the running build identity, configured roots, hard limits, supported
resource categories, and explicit non-capabilities.

**Parameters:** None.

---

### `list_formats`

**Description:** Lists implemented formats with support status, verification level, extensions, and
known limitations.

**Parameters:**

- **resourceType** (enum: `archive`, `image`, `audio`, `script`) _(optional)_: Filter by resource
  category.
- **formatId** (string) _(optional)_: Match one exact local format ID.
- **status** (string) _(optional)_: Filter by support status, such as `partial` or `verified`.
- **extension** (string) _(optional)_: Filter by an extension, with or without a leading dot.
- **detail** (enum: `summary`, `full`) _(optional)_: Include attribution and detailed support notes.
  Default is `summary`.
- **offset** (number) _(optional)_: Zero-based result offset. Default is `0`.
- **limit** (number) _(optional)_: Maximum results, from 1 to 1000. Default is `20`.
- **maxResponseBytes** (number) _(optional)_: Serialized response budget.

---

### `scan_resources`

**Description:** Scans a configured input root for recognized resources and returns a resumable
page with validation evidence and aggregate counts.

**Parameters:**

- **rootId** (string) **(required)**: Configured input root to scan.
- **path** (string) _(optional)_: Directory below the root. Default is `.`.
- **recursive** (boolean) _(optional)_: Scan subdirectories. Default is `true`.
- **includeGlobs** (string array) _(optional)_: Include at most 32 relative-path globs.
- **excludeGlobs** (string array) _(optional)_: Exclude at most 32 relative-path globs.
- **maxDepth** (number) _(optional)_: Recursion depth from 0 to 64. Default is `8`.
- **cursor** (string) _(optional)_: Opaque cursor returned by the previous page.
- **limit** (number) _(optional)_: Maximum scanned files, from 1 to 500. Default is `50`.
- **includeUnrecognized** (boolean) _(optional)_: Include unrecognized paths in the response. Default
  is `false`; their count is always returned.
- **resourceTypes** (array) _(optional)_: Filter recognized results by `archive`, `image`, `audio`, or
  `script`.
- **formatIds** (string array) _(optional)_: Filter recognized results by at most 128 exact format IDs.
- **maxResponseBytes** (number) _(optional)_: Serialized response budget.

---

### `inspect_archive`

**Description:** Detects and summarizes one source without returning its full entry list.

**Parameters:**

- **source** (source object) **(required)**: File below a configured input root.
- **detail** (enum: `summary`, `full`) _(optional)_: Include archive metadata. Default is `summary`.
- **maxResponseBytes** (number) _(optional)_: Serialized response budget.

---

### `list_entries`

**Description:** Lists and filters a bounded page of entries from one recognized archive.

**Parameters:**

- **source** (source object) **(required)**: Archive below a configured input root.
- **includeGlobs** (string array) _(optional)_: Include at most 32 entry-path globs.
- **excludeGlobs** (string array) _(optional)_: Exclude at most 32 entry-path globs.
- **caseSensitive** (boolean) _(optional)_: Make glob matching case-sensitive. Default is `false`.
- **compressed** (boolean) _(optional)_: Filter by archive compression flag.
- **encrypted** (boolean) _(optional)_: Filter by archive encryption flag.
- **resourceTypes** (array) _(optional)_: Filter by `audio`, `image`, `script`, or `unknown`.
- **detail** (enum: `summary`, `full`) _(optional)_: Include raw paths, checksums, and metadata.
  Default is `summary`.
- **offset** (number) _(optional)_: Zero-based matched-entry offset. Default is `0`.
- **limit** (number) _(optional)_: Maximum entries, from 1 to 1000. Default is `50`.
- **maxResponseBytes** (number) _(optional)_: Serialized response budget.

---

## Extraction

### `plan_extraction`

**Description:** Preflights a single-source extraction without writing files. It resolves selected
entries and destinations, checks conflicts and budgets, and returns a `planDigest` that execution can
require.

**Parameters:**

- **source** (source object) **(required)**: Archive or supported resource to plan.
- **selection** (selection object) _(optional)_: Entries to plan. Default is `{"mode":"all"}`.
- **outputRootId** (string) _(optional)_: Named output root. Defaults to the first configured root.
- **outputSubdirectory** (string) _(optional)_: Relative destination directory. By default the server
  uses `<input-root-id>/<source-path>.extracted`.
- **conflictPolicy** (enum: `fail`, `skip`, `overwrite`) _(optional)_: Existing-file policy. Default
  is `fail`.
- **budgets** (budget object) _(optional)_: Resource, byte, and timeout limits.
- **inline** (enum: `summary`, `all`) _(optional)_: Include planned item rows. Default is `summary`.
- **itemLimit** (number) _(optional)_: Maximum inline rows, from 0 to 100. Default is `20`.
- **maxResponseBytes** (number) _(optional)_: Serialized response budget.

---

### `extract_entries`

**Description:** Extracts selected entries from one source and saves a complete JSON report. The
same tool can page a saved report without running extraction again.

**Parameters:**

- **source** (source object) _(conditionally required)_: Source to extract. Provide exactly one of
  `source` and `reportPath`.
- **reportPath** (string) _(conditionally required)_: Generated `.garbro-reports/<id>.json` path to
  read instead of extracting.
- **selection** (selection object) _(optional)_: Entries to extract. Default is
  `{"mode":"all"}`.
- **outputRootId** (string) _(optional)_: Named destination root, or report root when reading a report.
- **outputSubdirectory** (string) _(optional)_: Relative extraction directory.
- **expectedPlanDigest** (64-character string) _(optional)_: Reject execution if the plan changed.
- **conflictPolicy** (enum: `fail`, `skip`, `overwrite`) _(optional)_: Existing-file policy. Default
  is `fail`.
- **budgets** (budget object) _(optional)_: Resource, byte, and timeout limits.
- **inline** (enum: `summary`, `errors`, `all`) _(optional)_: Inline result detail. Default is
  `errors`.
- **itemLimit** (number) _(optional)_: Maximum inline items, from 0 to 100. Default is `10`.
- **offset** (number) _(optional)_: Report-page offset. Extraction itself requires `0`. Default is `0`.
- **maxResponseBytes** (number) _(optional)_: Serialized response budget.

The result includes counts, `hasFailures`, and a report artifact containing its output root, path,
size, and SHA-256. Always inspect `hasFailures`; a partial result is not reported as complete.

---

### `extract_resources`

**Description:** Extracts all entries from several source resources in one request. It preflights
aggregate budgets before the first write and saves a separate report for every completed source.

**Parameters:**

- **sources** (source object array) **(required)**: Between 1 and 32 sources.
- **outputRootId** (string) _(optional)_: Named destination root.
- **conflictPolicy** (enum: `fail`, `skip`, `overwrite`) _(optional)_: Existing-file policy. Default
  is `fail`.
- **budgets** (budget object) _(optional)_: Aggregate resource and byte limits plus timeout.
- **inline** (enum: `summary`, `errors`, `all`) _(optional)_: Per-source inline detail. Default is
  `errors`.
- **itemLimit** (number) _(optional)_: Maximum inline items per source, from 0 to 100. Default is `10`.
- **offset** (number) _(optional)_: Zero-based source-result offset. Default is `0`.
- **limit** (number) _(optional)_: Maximum source results, from 1 to 32. Default is `8`.
- **maxResponseBytes** (number) _(optional)_: Serialized response budget.

Unlike `extract_entries`, this tool does not accept per-entry selection or a custom output
subdirectory. Use it when whole-resource extraction and an aggregate budget are desired.

---

## Background extraction

### `start_extraction`

**Description:** Submits one extraction as an in-process background job and immediately returns a
`jobId`. Use it for large archives or operations whose duration is uncertain.

**Parameters:**

- **source** (source object) **(required)**: Source to extract.
- **selection** (selection object) _(optional)_: Entries to extract. Default is
  `{"mode":"all"}`.
- **outputRootId** (string) _(optional)_: Named destination root.
- **outputSubdirectory** (string) _(optional)_: Relative extraction directory.
- **expectedPlanDigest** (64-character string) _(optional)_: Reject execution if the plan changed.
- **conflictPolicy** (enum: `fail`, `skip`, `overwrite`) _(optional)_: Existing-file policy. Default
  is `fail`.
- **budgets** (budget object) _(optional)_: Resource, byte, and timeout limits.

Jobs live only in the running MCP server process. Extracted files and completed reports remain on
disk, but job IDs do not survive a restart.

---

### `get_extraction_status`

**Description:** Polls a background extraction. Terminal states are `completed`, `partial`,
`failed`, and `cancelled`; active states are `queued` and `running`.

**Parameters:**

- **jobId** (UUID string) **(required)**: ID returned by `start_extraction`.
- **inline** (enum: `summary`, `errors`, `all`) _(optional)_: Terminal item detail. Default is
  `errors`.
- **itemLimit** (number) _(optional)_: Maximum inline items, from 0 to 100. Default is `10`.
- **maxResponseBytes** (number) _(optional)_: Serialized response budget.

Running jobs include progress and may include a total and current entry path. Terminal results
include extraction counts and the saved report artifact. Use `extract_entries` with that
`reportPath` to page the complete report.

---

### `cancel_extraction`

**Description:** Requests cooperative cancellation of a queued or running extraction job.

**Parameters:**

- **jobId** (UUID string) **(required)**: ID returned by `start_extraction`.

Cancellation does not roll back files that were already written. Poll `get_extraction_status` until
the state becomes `cancelled` or another terminal state.

---

## Verification

### `verify_artifacts`

**Description:** Reopens extracted files below configured output roots, computes SHA-256, and
performs independent WAV or Ogg structural inspection when applicable.

**Parameters:**

- **artifacts** (array) **(required)**: Between 1 and 100 artifact objects.
  - **path** (string) **(required)**: Relative path below an output root.
  - **outputRootId** (string) _(optional)_: Named output root.
  - **expected.sha256** (64-character hexadecimal string) _(optional)_: Expected file hash.
  - **expected.bytes** (decimal string) _(optional)_: Expected file size.
- **maxResponseBytes** (number) _(optional)_: Serialized response budget.

Without expected values, evidence is `hash` or `structural`. Matching expected values promote the
result to `manifest`; mismatches and invalid media structures are returned explicitly.
