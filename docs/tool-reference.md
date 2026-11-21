# garbro-mcp Tool Reference

garbro-mcp exposes one asynchronous work entry point and two task-control tools:

- [`submit_task`](#submit_task)
- [`get_task`](#get_task)
- [`cancel_task`](#cancel_task)

Server metadata and the format catalog are MCP resources rather than tools:

- `garbro://server/info`
- `garbro://formats`

## Task lifecycle

`submit_task` waits up to one second by default so short work can finish in one call. Otherwise it
returns an active `taskId`. Call `get_task` with its default server-side wait until `state` is one
of `completed`, `partial`, `failed`, or `cancelled`. Active states are `queued` and `running`.

Use `submit_task` for end-user asset requests as well as archive-oriented requests. Terms such as
cursor, sprite, CG, background, audio, and script should route here even when the user does not name
a file format. Prefer it over calling a local GARBro executable or library or writing an ad hoc
extractor.

Do not call `sleep` or choose a polling interval. When `get_task` returns `waitOutcome: "timeout"`,
call it again immediately; the next call waits on the server again.

Running tasks may report these phases:

- `scanning`
- `searching`
- `inspecting`
- `planning`
- `extracting`
- `verifying`

Task IDs are held by the running MCP process. A server restart loses task status. Extraction
artifacts remain in temporary storage only until their reported `expiresAt` time and should be
delivered elsewhere by the calling agent when the user requests it.

## Common values

Sources use absolute paths for the current operating system:

```json
{ "path": "D:/Games/Rewrite/voice.xp3" }
```

Relative paths are rejected. Byte budgets are decimal strings so they remain lossless in JSON.

Extraction selections are:

```json
{ "mode": "all" }
```

```json
{ "mode": "ids", "entryIds": ["0", "1"] }
```

```json
{
  "mode": "glob",
  "includeGlobs": ["voice/**/*.ogg"],
  "excludeGlobs": ["**/unused/**"],
  "resourceTypes": ["audio"]
}
```

Entry resource types are `archive`, `audio`, `image`, `script`, and `unknown`. Classification describes media
type, not character ownership or another semantic role. Filename matches may be presented as
candidates, but semantic claims require verification from the extracted artifacts or other
evidence.

## `submit_task`

Submits a bounded `scan`, `search`, `inspect`, or `extract` task and waits briefly for fast completion.

### Parameters

- **task** (task object) **required**: Work description documented below.
- **idempotencyKey** (string) optional: Repeated submissions with the same key return the existing
  task while it remains known to the server.
- **waitMs** (integer, 0–5000) optional: Fast-completion window. The default is `1000`; use `0` when
  the caller must receive the task ID without waiting.

### Scan task

```json
{
  "task": {
    "type": "scan",
    "path": "D:/Games/Rewrite",
    "recursive": true,
    "resourceTypes": ["archive", "audio"],
    "limit": 50
  }
}
```

Optional fields are `includeGlobs`, `excludeGlobs`, `maxDepth`, `cursor`, `limit`,
`includeUnrecognized`, `resourceTypes`, and `formatIds`. Use the returned `nextCursor` to submit the
next page. When `includeUnrecognized` is true, each unrecognized item includes a structured
`diagnosis`: `registered-extension-no-match` lists implemented candidates that rejected the file,
`no-registered-format` reports an extension with no implementation, and `unknown-format` is used
when no extension is available.

### Search task

Use `search` when the starting point is a directory and the desired resource is inside a file.
It applies the requested types to archive entries. The `scan` task applies its type filter to
files in the directory.

```json
{
  "task": {
    "type": "search",
    "path": "D:/Games/MyGame",
    "resourceTypes": ["audio"],
    "samplesPerArchive": 1
  }
}
```

Each matching archive in `result.archives` has a `source`, `formatId`, `matchedTotal` and
an `entries` array. Choose a sample by its path and pass its `extractSource` unchanged in
the next task's `sources` array.

```js
const entry = result.archives[0].entries[0];
const task = { type: "extract", sources: [entry.extractSource] };
```

`samplesPerArchive` defaults to 1 and accepts up to 10. To browse further within a matching
archive, use `inspect` with its source, the same resource types and an offset.
`limit` caps files examined per directory page (default 50, maximum 200). If `complete` is
false, submit the same search with `cursor` set to `nextCursor`, even if the page had no matches.
Search also accepts `recursive` and `maxDepth`. File-level errors appear in `failures` alongside
the results from files that could be searched.

### Inspect task

Inspection combines the former archive-summary and entry-list operations:

```json
{
  "task": {
    "type": "inspect",
    "source": { "path": "D:/Games/Rewrite/voice.xp3" },
    "includeEntries": true,
    "resourceTypes": ["audio"],
    "offset": 0,
    "limit": 50
  }
}
```

Optional entry filters are `includeGlobs`, `excludeGlobs`, `caseSensitive`, `compressed`,
`encrypted`, and `resourceTypes`. Set `includeMetadata` to include archive-specific metadata or
`includeEntries` to `false` when only a summary is needed.

The first entry page also includes `result.entries.overview`. Its counts and samples cover
the full set of matches, even with `limit: 1`. The overview groups entries by their parent
directory when there are multiple directories. For flat archives it looks for repeated filename
prefixes, such as `bg` in `bg001.png` or `voice` in `voice_001.ogg`. Flat archives with only
numbers, hashes, or one shared prefix can be browsed using the samples.

- To browse by a specific dimension, set `browse.by` to `directory` or `prefix`. Each group
  includes its match count and a `browse` object. Copy that object into the next inspection
  of the same source, keeping the same entry filters, to list that group's members. Keys
  are literal and case-sensitive. The empty key denotes the archive root for directory groups,
  or names without a detected prefix for prefix groups.
- To see more groups, set `browse.offset` to `overview.nextGroupOffset` and keep the entry
  `offset` at zero. Each group page lists up to 20 groups in order of first occurrence.
  To continue listing entries within a group, keep its selector and use the usual entry
  `nextOffset`.
- To extract a sample, pass its `extractSource` directly in an extraction task's `sources`
  array. The overview samples up to three distinct positions in archive order, at the
  beginning, middle and end of the filtered list. Each sample includes its zero-based offset.

```js
const [first] = result.entries.overview.samples;
if (first) {
  await client.callTool({
    name: "submit_task",
    arguments: { task: { type: "extract", sources: [first.extractSource] } }
  });
}
```

For an unrecognized file, `result.diagnosis` includes the detection stage, reason and suggested
next action. A DAT with registered readers that could not identify it includes the candidate
count in the message and the full IDs in `candidateFormatIds`. A PAZ with no registered reader
reports `no-registered-format`. When a reader encounters an unsupported feature, `error.details`
identifies the reader and failing stage. For example, a recognized CPZ6 whose index cannot be
decrypted reports its version and the index decryption failure.

Both `scan` and `search` return per-page `diagnostics` alongside matching files. Each group
includes the reason, count, next action and one example source. The text response summarizes
up to five groups, starting with reader errors. Use `inspect` on the example for the individual
diagnosis.

### Extract task

One task may extract between 1 and 32 sources:

```json
{
  "task": {
    "type": "extract",
    "sources": [
      {
        "source": { "path": "D:/Games/Rewrite/voice.xp3" },
        "selection": { "mode": "all", "resourceTypes": ["audio"] }
      }
    ],
    "budgets": {
      "maxResources": 10000,
      "maxOutputBytes": "10737418240",
      "timeoutMs": 3600000
    }
  }
}
```

Budgets may include `maxResources`, `maxInputBytes`, `maxOutputBytes`,
`maxDecodedBytesPerResource`, and `timeoutMs`.

The task always performs preflight before the first write. After extraction, every written artifact
is reopened and checked against its expected size and SHA-256. WAV and Ogg outputs also receive
structural inspection. There is no separate verification tool and verification cannot be disabled.

Each task gets a fresh UUID-named directory below the configured or operating-system temporary
root. Its result includes `temporary: true`, `artifactDirectory`, and `expiresAt`. Each source also
produces a complete JSON report under `.garbro-reports`. A task is `partial` when any entry fails
extraction or verification; verification failures are never reduced to warnings. Permanent
delivery is deliberately outside the MCP: the calling agent copies or transforms selected
artifacts only when instructed by the user.

When extraction writes files, both `submit_task` and `get_task` show the first three written
files across all sources in the terminal result. The text block lists each sample's absolute
path on the server, byte count and verification status, plus the shared expiration time in UTC.
For larger extractions it also gives the directory containing the full reports.

Structured clients can read the same values from `result.samples[]` (`absolutePath`,
`bytesWritten` as a decimal string, and `verificationStatus`) and `result.expiresAt`.
`result.extracted` counts all files written. Check each sample's verification status before
using it, including when a task finishes with partial success.

Formats that can identify media bytes behind an extensionless archive name may provide a safe
`outputExtension`. Planning exposes the resulting `outputEntryPath`, and extraction uses that same
path for conflict checks and writing. Reports retain the original `entryPath` while the artifact's
`relativePath` records the usable output name; media metadata may also include `mediaFormat` and
`mimeType`. This identifies the file representation only and does not imply character, dialogue, or
other semantic ownership.

## `get_task`

Waits on the server and returns a task snapshot. The default waits up to 30 seconds for a terminal
state, so the calling agent does not need a timer.

### Parameters

- **taskId** (UUID string) **required**: ID returned by `submit_task`.
- **waitUntil** (`none`, `change`, or `terminal`) optional: Defaults to `terminal`. `none` returns an
  immediate snapshot. `change` waits for a revision newer than `afterRevision`.
- **afterRevision** (non-negative integer) optional: Last observed `revision`, used with `change` to
  avoid missed-update races.
- **timeoutMs** (integer, 0–55000) optional: Maximum server-side wait; defaults to `30000`.

Every snapshot includes a monotonically increasing `revision` and a `waitOutcome`: `snapshot`,
`changed`, `terminal`, `timeout`, or `submitted`. Active snapshots include progress, total, phase,
and the current path when available. Terminal snapshots include a compact result. Extraction
results contain counts, verification totals, output directories, and report artifacts; detailed
per-entry evidence is stored in the report.

## `cancel_task`

Requests cooperative cancellation of a queued or running task.

### Parameters

- **taskId** (UUID string) **required**: ID returned by `submit_task`.

Cancellation does not roll back files already written. Call `get_task` with its default terminal
wait until the task reaches a terminal state.

## Resources

### `garbro://server/info`

Returns build identity, temporary-workspace policy, limits, supported task and resource categories,
and explicit non-capabilities.

### `garbro://formats`

Returns the complete implemented-format catalog with extensions, capabilities, attribution,
support status, verification level, and known limitations.
