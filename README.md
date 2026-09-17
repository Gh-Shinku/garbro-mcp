# garbro-mcp

> [!WARNING]
> This repository is under active development and is not ready for production or general use.
> Format behavior, extraction results, and MCP contracts may change without notice.

A modern TypeScript toolkit for parsing and extracting ADV/Galgame resource formats. The project
uses [GARbro](https://github.com/morkt/GARbro) as a format and algorithm reference while providing
independent, streaming implementations of its core API, CLI, and MCP server.

## Install the MCP server

Install Node.js 24 or newer, then download a versioned `garbro-mcp-<version>-portable.zip` from
[GitHub Releases](https://github.com/Gh-Shinku/garbro-mcp/releases) and extract it. The portable
server includes its runtime dependencies: no Git, pnpm, or build step is required.

Experimental release assets are published manually. If no portable ZIP is available yet, use the
[source installation guide](docs/development.md#requirements-and-setup).

Add the extracted stdio server to your MCP client configuration. Use absolute paths for the server,
input roots, and output root:

```json
{
  "mcpServers": {
    "garbro": {
      "command": "node",
      "args": [
        "C:/Tools/garbro-mcp/garbro-mcp.cjs",
        "--input-root", "games=D:/Games",
        "--output-root", "D:/garbro-output"
      ]
    }
  }
}
```

For filesystem policy, available tools, limits, and configuration details, read the
[MCP guide](docs/mcp.md).

Choose a fixed experimental version and verify it with `node garbro-mcp.cjs --version`. To update
or roll back, download another version, change the configured path, and restart your MCP client.
The optional `.tgz` can be installed locally with npm; see the [distribution guide](docs/distribution.md).

## Documentation

- [MCP installation, configuration, and tool contracts](docs/mcp.md)
- [Development setup, package layout, CLI, and testing](docs/development.md)
- [Experimental artifacts, checksums, and release workflow](docs/distribution.md)
- [Format support status and compatibility methodology](docs/support.md)
- [Individual format notes](docs/formats/)

## GARbro reference

This project uses [GARbro](https://github.com/morkt/GARbro) as a behavioral reference for resource
formats and decoding algorithms. It is an independent TypeScript reimplementation and is not
affiliated with, endorsed by, or a distribution of GARbro. Source attribution and applicable
licenses are recorded with each format implementation and in the format documentation.
