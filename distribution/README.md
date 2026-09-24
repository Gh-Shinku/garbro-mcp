# garbro-mcp experimental distribution

This is an experimental build, not a stable release. Keep a backup of your input data. Install
Node.js 24 or newer; no Git, pnpm, or dependency installation is needed for the portable ZIP.

The server handles supported resource formats. It does not reverse-engineer game logic, infer
character or voice ownership, or automatically support unknown engines. Clients should keep those
tasks with the user or an external analysis workflow.

Extract the ZIP and configure your MCP client:

```json
{
  "mcpServers": {
    "garbro": {
      "command": "node",
      "args": ["/absolute/path/garbro-mcp/garbro-mcp.cjs"]
    }
  }
}
```

On Windows, use paths such as `C:/Tools/garbro-mcp/garbro-mcp.cjs`.
Use an absolute Node executable path if your client cannot find `node` on PATH.

Check the exact build with `node garbro-mcp.cjs --version --json`, then run
`node garbro-mcp.cjs --doctor --json`. Game paths are provided as absolute paths in submitted tasks.
Extraction uses isolated, expiring directories below the operating system's temporary directory;
`--temp-dir` overrides that location. Use `--expected-build-id ID` to refuse to start a stale or
different bundle.

The optional `.tgz` installs locally with `npm install --global /path/to/garbro-mcp-VERSION.tgz`.
It contains the same self-contained server and requires no registry downloads for runtime
dependencies. Configure the client with `command: "garbro-mcp-server"` (or the installed absolute
executable path).

To update or roll back, download a specific version and change the configured bundle path; restart
the MCP client. Do not replace a running server automatically.

Source, tool contracts, and known limitations:
https://github.com/Gh-Shinku/garbro-mcp

The bundled dependency license texts are included in `THIRD_PARTY_NOTICES.md`. GARbro attribution
and its MIT license are retained in `LICENSE`.
