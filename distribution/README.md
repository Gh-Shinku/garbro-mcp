# garbro-mcp experimental distribution

This is an experimental build, not a stable release. Keep a backup of your input data and use a
separate output directory. Install Node.js 24 or newer; no Git, pnpm, or dependency installation is
needed for the portable ZIP.

Extract the ZIP and configure your MCP client:

```json
{
  "mcpServers": {
    "garbro": {
      "command": "node",
      "args": [
        "/absolute/path/garbro-mcp/garbro-mcp.cjs",
        "--input-root", "games=/absolute/path/games",
        "--output-root", "default=/absolute/path/garbro-output"
      ]
    }
  }
}
```

On Windows, use paths such as `C:/Tools/garbro-mcp/garbro-mcp.cjs` and `D:/Games`.
Use an absolute Node executable path if your client cannot find `node` on PATH.

Check the exact build with `node garbro-mcp.cjs --version --json`, then run the same configured
roots once with `--doctor --json`. Input and named output roots can be repeated. Extraction cannot
escape a configured output root; overwriting must be explicitly requested. Use
`--expected-build-id ID` to refuse to start a stale or different bundle.

The optional `.tgz` installs locally with `npm install --global /path/to/garbro-mcp-VERSION.tgz`.
It contains the same self-contained server and requires no registry downloads for runtime
dependencies. Configure the client with `command: "garbro-mcp-server"` (or the installed absolute
executable path), retaining the root arguments above.

To update or roll back, download a specific version and change the configured bundle path; restart
the MCP client. Do not replace a running server automatically.

Source, tool contracts, and known limitations:
https://github.com/Gh-Shinku/garbro-mcp

The bundled dependency license texts are included in `THIRD_PARTY_NOTICES.md`. GARbro attribution
and its MIT license are retained in `LICENSE`.
