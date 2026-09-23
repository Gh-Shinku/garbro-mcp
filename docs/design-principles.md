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
- **Plan before material writes:** Preflight selection, destinations, conflicts, and budgets before
  extracting large resources.
- **Explicit partial success:** Batch operations return per-item status and `hasFailures`; they do
  not hide failed entries behind a successful top-level call.
- **Source files are immutable:** Tools read configured game roots and write only to separate,
  configured output roots.
- **Bounded context:** Lists are paginated and responses have explicit byte budgets.
- **Agent-agnostic contracts:** Tools use MCP structured content and do not depend on one client or
  language model.

Format implementations use GARBro as a behavioral reference, not as an architectural template.
See [format support](support.md) and the [individual format notes](formats/) for compatibility scope.
