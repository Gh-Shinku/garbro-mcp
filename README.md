# garbro-mcp

A modern TypeScript toolkit for parsing and extracting ADV/Galgame resource formats. The project
uses [GARbro](https://github.com/morkt/GARbro) as a format and algorithm reference while providing
independent, streaming implementations of its core API, CLI, and MCP server.

The project currently includes archive support for:

- standard, unencrypted KiriKiri XP3 archives;
- Active Soft ADPACK32 archives, including CP932 filenames;
- Amaterasu Translations AMI archives, including zlib-compressed images;
- BGI/Ethornell PackFile and BURIKO ARC20 archives, including DSC and BSE data;
- Digital Romance System DRS archives;
- IKURA GDL (`SM2MPX10`) archives with built-in script transforms;
- Favorite View Point ACPXPK archives with ACP LZW compression;
- Escu:de ESC-ARC v1/v2 archives with encrypted indexes and ACP LZW entries;
- CRI AFS archives;
- CRI CPK archives, including TOC/ITOC indexes and CRILAYLA compression;
- Favorite View Point v2 BIN archives (`BIN/FVP`).

The XP3 implementation supports:

- archive detection and metadata inspection;
- raw and zlib-compressed indexes, including continued indexes;
- raw and zlib-compressed multi-segment files;
- listing, single-entry extraction, and complete archive extraction through the CLI and MCP;
- listing protected entries, with an explicit unsupported-feature error on extraction.

Game-specific XP3 encryption, obfuscated indexes, PEXP3/EXE-embedded archives, and archive creation
are not currently supported.

## Requirements and installation

- Node.js 24 or newer
- pnpm 11

```powershell
pnpm install
pnpm build
pnpm check
```

All workspace packages are private:

```text
packages/core      bigint binary I/O, format interfaces, registry, safe extraction
packages/codecs    reusable codecs
packages/formats   engine and format implementations
packages/cli       command-line interface
packages/mcp       MCP stdio server
```

## CLI

After building, invoke the CLI directly with Node:

```powershell
node packages/cli/dist/index.js formats
node packages/cli/dist/index.js detect data.xp3 --json
node packages/cli/dist/index.js list data.xp3
node packages/cli/dist/index.js extract-entry data.xp3 0 --output extracted
node packages/cli/dist/index.js extract-archive data.xp3 --output extracted
```

Extraction refuses to overwrite existing files by default. Add `--overwrite` explicitly to replace
regular files. Absolute archive paths, path traversal, Windows alternate data streams and device
names, and symbolic-link destinations are always rejected.

## MCP

The server uses stdio. Standard output is reserved for protocol messages, while diagnostics are
written to standard error.

```json
{
  "mcpServers": {
    "garbro": {
      "command": "node",
      "args": ["C:/path/to/garbro-mcp/packages/mcp/dist/index.js"]
    }
  }
}
```

The following tools are available:

- `detect_archive`
- `list_entries`
- `extract_entry`
- `extract_archive`
- `list_formats`

MCP tools return structured metadata and local paths only. All bigint values are encoded as decimal
strings, and large Base64 payloads are never returned.

## Tests and differential validation

```powershell
pnpm test
pnpm test:differential -- --archive fixtures/private/sample.xp3 --reference fixtures/private/garbro-output
```

The regular test suite uses deterministic, redistributable synthetic fixtures committed to the
repository. Differential tests compare this project's output with a private reference directory
extracted by GARbro, matching path, size, and SHA-256. `fixtures/private/` is excluded from version
control.

See [docs/formats/xp3.md](docs/formats/xp3.md) for XP3 format notes, implementation sources, and
known limitations. See [docs/support.md](docs/support.md) for the generated GARbro compatibility
baseline, status definitions, and current migration progress.
