# Troubleshooting

## The server does not start

Run the exact configured bundle manually:

```powershell
node C:/Tools/garbro-mcp/garbro-mcp.cjs --version --json
```

garbro-mcp requires Node.js 24 or newer. Use an absolute Node executable path when the MCP client
does not inherit your terminal's `PATH`.

## A configured root is rejected

Run `--doctor --json` with the same root declarations used by the client. Input roots must exist and
be readable. Output roots must be writable. Repeated output roots require `id=path` declarations.

See [configuration](configuration.md) for examples.

## A game file is not recognized

Use `scan_resources` with `includeUnrecognized: true`, then compare the file with
[format support](support.md). An unrecognized file may use an unsupported format, an unsupported
variant, encryption that needs game-specific material, or a different engine despite its extension.

Do not treat filename extensions alone as proof that a format is supported.

## The expected audio or image entries are missing

Use `inspect_archive`, then `list_entries` without a resource-type filter. Entries without explicit
metadata or a recognized extension are classified as `unknown`. The server does not infer semantic
relationships such as which character owns a voice file.

## Extraction reports `OUTPUT_EXISTS`

The default conflict policy is `fail`. Choose one of these deliberate actions:

- select a new `outputSubdirectory`;
- use `conflictPolicy: "skip"` to preserve existing files;
- use `conflictPolicy: "overwrite"` to replace existing regular files.

The server never overwrites directories, symbolic links, or other non-regular destinations.

## Extraction is slow or the MCP request times out

Use `start_extraction` and poll `get_extraction_status` instead of holding a long tool request open.
The job ID is in-memory state and is lost if the server process restarts. Completed output files and
saved reports remain on disk.

## An extraction is partial

Check `hasFailures`, failed inline items, and the generated report under `.garbro-reports`. Use
`extract_entries` with `reportPath` to page the complete report. A partial result can contain valid
artifacts alongside failed or skipped entries.

## An extracted file may be corrupt

Run `verify_artifacts` with the returned relative path and, when available, expected SHA-256 and
size. Verification can independently check hashes and basic WAV or Ogg structure. Format-specific
limitations are documented under [formats](formats/).
