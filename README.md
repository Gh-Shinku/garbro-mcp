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
- **Extract safely:** Every extraction task preflights destinations and budgets, writes into an
  isolated expiring temporary directory, and preserves source game files.
- **Handle long operations:** Scans, inspections, and extractions all run as background tasks with
  progress, cancellation, and one consistent control interface.
- **Verify automatically:** Extraction reopens every output, checks its size and SHA-256, inspects
  WAV or Ogg structure, and saves complete evidence without an extra agent step.

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
- Read access to the game directory selected in the conversation

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
        "C:/Tools/garbro-mcp/garbro-mcp.cjs"
      ]
    }
  }
}
```

Before connecting the client, verify the bundle and temporary workspace:

```powershell
node C:/Tools/garbro-mcp/garbro-mcp.cjs --version --json
node C:/Tools/garbro-mcp/garbro-mcp.cjs --doctor --json
```

See [configuration](docs/configuration.md) for temporary-directory overrides, source-checkout
setup, and the filesystem policy.

### Your first prompt

Give the game path and desired resources in the request. Delivery is a separate agent action:

```text
Scan the Rewrite game at D:/Games/Rewrite. Identify archives containing audio entries, extract the
audio to temporary storage, and report any extraction or verification failures. Do not modify any
game files. After I review the result, copy the selected files to D:/Exports/Rewrite-audio.
```

The agent submits `scan`, `inspect`, and `extract` tasks through `submit_task`, then uses
`get_task`'s server-side wait. It does not sleep or guess polling intervals. Planning and
post-extraction verification are mandatory internal extraction phases.
The MCP does not choose a permanent destination or copy artifacts there; the calling agent follows
the user's delivery instruction after extraction.

## Tools

See the complete [tool reference](docs/tool-reference.md) for the three task-control tools, task
types, selection modes, budgets, automatic verification, reports, and lifecycle states.

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
