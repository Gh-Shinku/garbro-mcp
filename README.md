# GARBro formats for agents

garbro-mcp lets coding agents inspect and extract supported ADV/Galgame resource files. It is a
Model Context Protocol (MCP) server backed by independent TypeScript implementations of formats and
codecs documented by [GARBro](https://github.com/morkt/GARBro).

[Tool reference](docs/tool-reference.md) | [Configuration](docs/configuration.md) | [Troubleshooting](docs/troubleshooting.md) | [Format support](docs/support.md) | [Design principles](docs/design-principles.md)

> [!WARNING]
> This project is under active development. Format coverage, extraction behavior, and MCP contracts
> may change between experimental releases.

## Key features

- **Discover supported resources:** Scan game directories and identify known archives, images,
  audio, and scripts with validation evidence.
- **Select the data that matters:** Filter archive entries by path, compression, encryption, and
  conservative media category.
- **Extract safely:** Preflight destinations and budgets, write only below configured output roots,
  and preserve source game files.
- **Handle long operations:** Submit large single-archive extractions as background jobs and poll
  progress without holding an MCP request open.
- **Verify output:** Record byte counts and SHA-256 hashes, save complete extraction reports, and
  inspect WAV or Ogg structure.

## Product boundary

garbro-mcp is resource-access infrastructure. It does not reverse-engineer game logic, adapt
unknown engines, decompile executables, or infer relationships such as character-to-voice ownership.
Those tasks remain with the calling agent, a specialized analysis tool, or the user.

Entry categories such as `audio` and `image` describe file media types. They are not claims about a
resource's role in the game. When the available evidence is insufficient, the server reports
`unknown`.

## Requirements

- Node.js 24 or newer
- A portable release bundle, or a source checkout built with pnpm 11.26.0
- Separate readable game and writable output directories

## Getting started

Download a versioned `garbro-mcp-<version>-portable.zip` from
[GitHub Releases](https://github.com/Gh-Shinku/garbro-mcp/releases) and extract it. Configure your
MCP client with absolute paths:

```json
{
  "mcpServers": {
    "garbro": {
      "command": "node",
      "args": [
        "C:/Tools/garbro-mcp/garbro-mcp.cjs",
        "--input-root", "games=D:/Games",
        "--output-root", "default=D:/garbro-output"
      ]
    }
  }
}
```

Before connecting the client, verify the bundle and roots:

```powershell
node C:/Tools/garbro-mcp/garbro-mcp.cjs --version --json
node C:/Tools/garbro-mcp/garbro-mcp.cjs --input-root games=D:/Games --output-root default=D:/garbro-output --doctor --json
```

See [configuration](docs/configuration.md) for multiple roots, source-checkout setup, and the
filesystem policy.

### Your first prompt

Try a request that keeps discovery and extraction explicit:

```text
Scan the Rewrite game under the configured games root. Identify archives containing audio entries,
plan extraction into the default output root, then start the extraction as a background job. Do not
modify any game files.
```

The agent should use `scan_resources`, `list_entries`, and `plan_extraction` before writing, then
`start_extraction` and `get_extraction_status` for a large operation.

## Tools

See the complete [tool reference](docs/tool-reference.md) for all 12 MCP tools, their parameters,
selection modes, budgets, pagination, extraction reports, and asynchronous job states.

## Format documentation

Format-specific documentation remains a first-class part of this project:

- [Support status and compatibility methodology](docs/support.md)
- [Individual format notes](docs/formats/)
- [Deferred formats and missing prerequisites](docs/deferred-formats.md)
- [GARBro inventory](docs/garbro-inventory.json)
- [Private test-data targets](docs/test-data-targets.md)

Development setup and release procedures are documented in
[development](docs/development.md) and [distribution](docs/distribution.md).

## GARBro reference

This project uses GARBro as a behavioral reference for resource formats and decoding algorithms. It
is an independent TypeScript reimplementation and is not affiliated with, endorsed by, or a
distribution of GARBro. Source attribution and applicable licenses are recorded with each format
implementation and in the format documentation.
