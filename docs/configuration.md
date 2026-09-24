# Configuration

garbro-mcp is a stdio MCP server. Game paths are supplied as absolute paths when an agent submits a
task, so changing games does not require editing the MCP configuration or restarting the server.
Extraction always goes to server-managed temporary storage first.

## Server options

- **`--temp-dir <path>`**
  Override the temporary workspace root. The default is `garbro-mcp` below the operating system's
  standard temporary directory.
  - **Type:** absolute path

- **`--temp-retention-hours <n>`**
  Set how long task directories remain eligible for access before cleanup.
  - **Type:** positive number
  - **Default:** `24`

- **`--expected-build-id <id>`**
  Refuse to start when the bundle does not have the expected immutable build ID.
  - **Type:** string

- **`--doctor`**
  Validate the build identity and temporary workspace, then exit.
  - **Type:** boolean
  - **Default:** `false`

- **`--json`**
  Emit machine-readable output with `--version` or `--doctor`.
  - **Type:** boolean
  - **Default:** `false`

- **`--version`, `-v`**
  Print the server version and exit.
  - **Type:** boolean

- **`--help`, `-h`**
  Print command-line help and exit.
  - **Type:** boolean

## MCP client configuration

Portable ZIP example on Windows:

```json
{
  "mcpServers": {
    "garbro": {
      "command": "node",
      "args": ["C:/Tools/garbro-mcp/garbro-mcp.cjs"]
    }
  }
}
```

Source checkout example with a custom temporary directory:

```json
{
  "mcpServers": {
    "garbro-dev": {
      "command": "node",
      "args": [
        "C:/Users/me/Code/garbro-mcp/packages/mcp/dist/index.js",
        "--temp-dir", "D:/garbro-temporary",
        "--temp-retention-hours", "48"
      ]
    }
  }
}
```

Use absolute paths for the server and custom temporary directory. If the MCP client cannot find
`node`, use the absolute path to the Node.js executable.

## Filesystem policy

Tasks address a game directory or resource file with an absolute local path selected from the
current conversation:

```json
{ "path": "D:/Games/Rewrite/voice.xp3" }
```

The server rejects relative task paths, unsafe archive entry destinations, and writes outside its
temporary workspace. Source game files are opened read-only. Each extraction task receives a new
UUID-named directory and returns its `artifactDirectory` and `expiresAt`; existing task artifacts
are never selected as an overwrite destination.

The temporary directory is staging storage, not the user's final delivery location. After a task
finishes, the calling agent may inspect, transform, or copy verified artifacts according to the
user's instruction and its own filesystem permissions. garbro-mcp does not choose or restrict that
final destination.

Cleanup is lazy: expired UUID task directories are removed when the temporary workspace is next
prepared. Files should not be expected to remain available after `expiresAt`.

## Check a configuration

Record the exact build and validate the temporary workspace:

```powershell
node C:/Tools/garbro-mcp/garbro-mcp.cjs --version --json
node C:/Tools/garbro-mcp/garbro-mcp.cjs --doctor --json
```

When overriding temporary storage, pass the same option used by the MCP client:

```powershell
node C:/Tools/garbro-mcp/garbro-mcp.cjs `
  --temp-dir D:/garbro-temporary `
  --doctor --json
```

See the [tool reference](tool-reference.md) for task fields and result lifecycle.
