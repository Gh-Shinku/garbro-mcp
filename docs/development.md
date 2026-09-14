# Development guide

## Requirements and setup

- Node.js 24 or newer
- pnpm 11

```shell
pnpm install
pnpm build
pnpm check
```

The repository is a private pnpm workspace:

```text
packages/core      bigint binary I/O, format interfaces, registry, safe extraction
packages/codecs    reusable codecs
packages/formats   engine and format implementations
packages/cli       command-line interface
packages/mcp       MCP stdio server
```

Core parsing, decoding, and extraction logic must remain independent of MCP. The MCP package is a
thin protocol adapter over the core APIs. Format implementations should remain modular and
independently testable.

Contributor workflow and commit conventions are defined in [AGENTS.md](../AGENTS.md).

## CLI

After building, invoke the development CLI directly with Node:

```shell
node packages/cli/dist/index.js formats
node packages/cli/dist/index.js detect data.xp3 --json
node packages/cli/dist/index.js list data.xp3
node packages/cli/dist/index.js extract-entry data.xp3 0 --output extracted
node packages/cli/dist/index.js extract-archive data.xp3 --output extracted
```

Extraction refuses to overwrite existing files by default. Add `--overwrite` explicitly to replace
regular files. Absolute archive paths, path traversal, Windows alternate data streams and device
names, and symbolic-link destinations are always rejected.

## Tests and differential validation

```shell
pnpm test
pnpm test:differential -- --archive fixtures/private/sample.xp3 --reference fixtures/private/garbro-output
```

The regular test suite uses deterministic, redistributable synthetic fixtures committed to the
repository. Differential tests compare this project's output with a private reference directory
extracted by GARBro, matching path, size, and SHA-256. `fixtures/private/` is excluded from version
control.

Format-specific sources, implementation details, and limitations belong under `docs/formats/`.
The generated GARBro compatibility baseline and status definitions are documented in
[support.md](support.md).
