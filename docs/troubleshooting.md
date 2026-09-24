# Troubleshooting

## The server does not start

Run the exact configured bundle manually:

```powershell
node C:/Tools/garbro-mcp/garbro-mcp.cjs --version --json
```

garbro-mcp requires Node.js 24 or newer. Use an absolute Node executable path when the MCP client
does not inherit your terminal's `PATH`.

## The temporary workspace is rejected

Run `--doctor --json` with the same `--temp-dir` used by the client. It must be an absolute path to
a real writable directory and cannot be a filesystem root. Omit the option to use the operating
system's standard temporary directory.

See [configuration](configuration.md) for examples.

## A game file is not recognized

Submit a `scan` task with `includeUnrecognized: true`, then compare the result with [format
support](support.md). An unrecognized file may use an unsupported format, an unsupported variant,
encryption that needs game-specific material, or a different engine despite its extension.

Do not treat filename extensions alone as proof that a format is supported.

## The expected audio or image entries are missing

Submit an `inspect` task without a resource-type filter. It returns both the archive summary and a
bounded entry page. Entries without explicit metadata or a recognized extension are classified as
`unknown`. The server does not infer relationships such as which character owns a voice file.

## Extraction is slow or the MCP request times out

All operations run asynchronously. Call `get_task` using the ID returned by `submit_task`; its
default behavior waits server-side for terminal completion. Do not use `sleep`. If the 30-second
wait returns `waitOutcome: "timeout"`, call `get_task` again immediately. The task ID is in-memory
state and is lost if the server process restarts. Completed artifacts and reports remain in the
task's temporary directory only until its reported `expiresAt` time.

## An extraction is partial

Check `hasFailures`, verification totals, and the generated report under `.garbro-reports`. A
partial result can contain valid artifacts alongside failed, invalid, mismatched, or skipped
entries.

## An extracted file may be corrupt

Do not submit another tool call. Verification is a mandatory extraction phase and its evidence is
stored in the generated report. Inspect the per-item verification status, expected size and hash,
and WAV or Ogg structural warnings. Format-specific limitations are documented under
[formats](formats/).
