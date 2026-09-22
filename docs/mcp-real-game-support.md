# Real-game MCP support boundary

The MCP server has been exercised against a read-only `Rewrite` installation. Generated files,
reports, and validation output belong under a configured temporary output root; the input game
directory is never used as an output location.

The private validation harness records only relative paths, sizes, SHA-256 hashes, and expected
metadata in the ignored `fixtures/private/` directory. It does not copy game payloads into the
repository. When the private corpus and FFmpeg are available, the harness checks all 376 NWA files,
raw and compressed WAV output, OVK Ogg preservation, collision negatives, source hashes, FFprobe
metadata, and FFmpeg decoding. Without those prerequisites, the tests skip cleanly.

The documented MCP workflow is:

- `scan_resources` discovers validated resources. `scan_archives` remains a compatibility alias.
- Discovery accepts `resourceTypes` and `formatIds` filters and reports format support metadata,
  validation depth, qualitative confidence, warnings, and page-level aggregate counts.
- `inspect_archive` returns the same detection evidence and, for NWA, decoded bytes, sample frames,
  block alignment, duration, channels, sample rate, and compression.
- `extract_entries` always reports `hasFailures`; failed items include format and decoder IDs and
  reports remain hashable. `extract_resources` handles a bounded batch with per-source reports.
- The decoded-resource policy is visible as `limits.decodedResourceMaxBytes` in
  `get_server_info`; a valid NWA over policy returns `LIMIT_EXCEEDED`.

Known weaknesses remain explicit:

- Format support is still mostly synthetic-fixture verified in the support catalog. Real-game
  verification is private and must not be inferred for formats not covered by that harness.
- Detection confidence is qualitative, not calibrated. Signatureless or extension-fallback formats
  can still be ambiguous even after structural validation.
- NWA decoding currently reads a complete source and decoded PCM into memory. The configurable
  ceiling prevents unbounded allocation, but streaming/block-wise decoding is still needed for
  very large archives.
- Page budgets are conservative because MCP structured content is accompanied by a short textual
  compatibility notice. Callers should use structured content and honor cursors/offsets.
- Audio integrity probing beyond metadata and an independent FFmpeg check is not yet exposed as a
  per-request MCP option.
- Aggregate discovery counts describe the files inspected in the current scan page, not a hidden
  whole-game index; callers must consume all cursors for a complete inventory.
