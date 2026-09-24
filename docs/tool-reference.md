# garbro-mcp Tool Reference

garbro-mcp exposes one asynchronous work entry point and two task-control tools:

- [`submit_task`](#submit_task)
- [`get_task`](#get_task)
- [`cancel_task`](#cancel_task)

Server metadata and the format catalog are MCP resources rather than tools:

- `garbro://server/info`
- `garbro://formats`

## Task lifecycle

`submit_task` returns immediately with a `taskId`. Poll `get_task` until `state` is one of
`completed`, `partial`, `failed`, or `cancelled`. Active states are `queued` and `running`.

Running tasks may report these phases:

- `scanning`
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

Entry resource types are `audio`, `image`, `script`, and `unknown`. Classification describes media
type, not character ownership or another semantic role.

## `submit_task`

Submits a bounded `scan`, `inspect`, or `extract` task and immediately returns its initial snapshot.

### Parameters

- **task** (task object) **required**: Work description documented below.
- **idempotencyKey** (string) optional: Repeated submissions with the same key return the existing
  task while it remains known to the server.

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

An unrecognized source returns the same structured diagnosis used by scanning. For example, a CPZ
variant not handled by the implemented CPZ1/CPZ2 readers reports
`registered-extension-no-match` with both reader IDs; a PAZ file reports `no-registered-format`
until a PAZ reader is registered. These results are format-support evidence, not generic I/O errors.

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

Formats that can identify media bytes behind an extensionless archive name may provide a safe
`outputExtension`. Planning exposes the resulting `outputEntryPath`, and extraction uses that same
path for conflict checks and writing. Reports retain the original `entryPath` while the artifact's
`relativePath` records the usable output name; media metadata may also include `mediaFormat` and
`mimeType`. This identifies the file representation only and does not imply character, dialogue, or
other semantic ownership.

## `get_task`

Returns the latest task snapshot.

### Parameters

- **taskId** (UUID string) **required**: ID returned by `submit_task`.

Active snapshots include progress, total, phase, and the current path when available. Terminal
snapshots include a compact result. Extraction results contain counts, verification totals, output
directories, and report artifacts; detailed per-entry evidence is stored in the report.

## `cancel_task`

Requests cooperative cancellation of a queued or running task.

### Parameters

- **taskId** (UUID string) **required**: ID returned by `submit_task`.

Cancellation does not roll back files already written. Continue polling `get_task` until the task
reaches a terminal state.

## Resources

### `garbro://server/info`

Returns build identity, temporary-workspace policy, limits, supported task and resource categories,
and explicit non-capabilities.

### `garbro://formats`

Returns the complete implemented-format catalog with extensions, capabilities, attribution,
support status, verification level, and known limitations.
