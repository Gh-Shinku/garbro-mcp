# garbro-mcp experimental distribution

This is an experimental build, not a stable release. Keep a backup of your input data. Install
Node.js 24 or newer; no Git, pnpm, or repository checkout is needed.

The server handles supported resource formats. It does not reverse-engineer game logic, infer
character or voice ownership, or automatically support unknown engines. Clients should keep those
tasks with the user or an external analysis workflow.

Run the published package directly:

```shell
npx --yes garbro-mcp@latest --version
npx --yes garbro-mcp@latest --doctor --json
```

Configure your MCP client to start it over stdio:

```json
{
  "mcpServers": {
    "garbro": {
      "command": "npx",
      "args": ["--yes", "garbro-mcp@latest"]
    }
  }
}
```

On Windows, use `npx.cmd` if the MCP client does not resolve command shims. For reproducible
environments, replace `@latest` with an exact version. Pinning makes updates and rollbacks explicit.

Game paths are provided as absolute paths in submitted tasks. Extraction uses isolated, expiring
directories below the operating system's temporary directory; `--temp-dir` overrides that
location. Use `--expected-build-id ID` to refuse to start a stale or different bundle.

Alternatively, install the command globally:

```shell
npm install --global garbro-mcp@latest
garbro-mcp --version
```

For offline use, install the release `.tgz` with
`npm install --global /path/to/garbro-mcp-VERSION.tgz`, or extract the portable ZIP and configure
the client to run `node /absolute/path/garbro-mcp/garbro-mcp.cjs`.

Restart the MCP client after changing versions. Do not replace a running server automatically.

Source, tool contracts, and known limitations:
https://github.com/Gh-Shinku/garbro-mcp

The bundled dependency license texts are included in `THIRD_PARTY_NOTICES.md`. GARbro attribution
and its MIT license are retained in `LICENSE`.
