# garbro-mcp

> [!WARNING]
> This repository is under active development and is not ready for production or general use.
> Format behavior, extraction results, and MCP contracts may change without notice.

A modern TypeScript toolkit for parsing and extracting ADV/Galgame resource formats. The project
uses [GARbro](https://github.com/morkt/GARbro) as a format and algorithm reference while providing
independent, streaming implementations of its core API, CLI, and MCP server.

## Install the MCP server

The server is currently available only by building this repository from source. Install Node.js 24
or newer and pnpm 11, then run:

```shell
git clone https://github.com/Gh-Shinku/garbro-mcp.git
cd garbro-mcp
pnpm install
pnpm build
```

Add the built stdio server to your MCP client configuration. Use absolute paths for the server,
input roots, and output root:

```json
{
  "mcpServers": {
    "garbro": {
      "command": "node",
      "args": [
        "C:/path/to/garbro-mcp/packages/mcp/dist/index.js",
        "--input-root", "games=D:/Games",
        "--output-root", "D:/garbro-output"
      ]
    }
  }
}
```

For filesystem policy, available tools, limits, and configuration details, read the
[MCP guide](docs/mcp.md).

## Documentation

- [MCP installation, configuration, and tool contracts](docs/mcp.md)
- [Development setup, package layout, CLI, and testing](docs/development.md)
- [Format support status and compatibility methodology](docs/support.md)
- [Individual format notes](docs/formats/)

## GARbro reference

This project uses [GARbro](https://github.com/morkt/GARbro) as a behavioral reference for resource
formats and decoding algorithms. It is an independent TypeScript reimplementation and is not
affiliated with, endorsed by, or a distribution of GARbro. Source attribution and applicable
licenses are recorded with each format implementation and in the format documentation.
