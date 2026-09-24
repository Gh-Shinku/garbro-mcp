# Design Principles

These principles define the intended boundary of the MCP server.

- **Reliable resource access:** Detect, inspect, decode, extract, and verify formats with known
  implementations.
- **Thin MCP layer:** Parsing, codecs, extraction, and safety policy live in reusable core packages.
- **Reference over payload:** Large results are written to files and represented by paths, hashes,
  counts, and saved reports instead of being copied into model context.
- **Conservative classification:** Return `unknown` when a media category cannot be supported by
  format metadata or a recognized extension.
- **No semantic guessing:** Character, dialogue, voice, sprite, or story relationships require
  external analysis or user input.
- **One asynchronous work model:** Scan, inspect, and extract operations are submitted as tasks;
  agents never need to choose between synchronous and background variants.
- **Plan before material writes:** Every extraction task preflights selection, destinations,
  conflicts, and budgets before writing.
- **Verification is part of extraction:** A task cannot complete successfully until every written
  artifact has been independently reopened and verified at its supported evidence level.
- **Explicit partial success:** Batch operations return per-item status and `hasFailures`; they do
  not hide failed entries behind a successful top-level call.
- **Source files are immutable:** Tools read absolute game paths selected for the current request
  and write extraction artifacts only to isolated temporary task directories.
- **Bounded context:** Lists are paginated and responses have explicit byte budgets.
- **Agent-agnostic contracts:** Tools use MCP structured content and do not depend on one client or
  language model.

Format implementations use GARBro as a behavioral reference, not as an architectural template.
See [format support](support.md) and the [individual format notes](formats/) for compatibility scope.
