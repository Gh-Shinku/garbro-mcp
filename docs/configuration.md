# Configuration

garbro-mcp is a stdio MCP server. Its command-line options define which game directories the agent
may read and where extracted files may be written.

## Server options

- **`--input-root <id=path>`**
  Add a named readable root. Repeat the option to expose multiple directories.
  - **Type:** string
  - **Example:** `--input-root games=D:/Games`

- **`--output-root <[id=]path>`**
  Add a writable root. Repeatable declarations must use an ID.
  - **Type:** string
  - **Example:** `--output-root default=D:/garbro-output`

- **`--expected-build-id <id>`**
  Refuse to start when the bundle does not have the expected immutable build ID.
  - **Type:** string

- **`--doctor`**
  Validate the build identity and configured roots, then exit.
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
      "args": [
        "C:/Tools/garbro-mcp/garbro-mcp.cjs",
        "--input-root", "games=D:/Games",
        "--output-root", "default=D:/garbro-output",
        "--output-root", "audio=D:/ExtractedAudio"
      ]
    }
  }
}
```

Source checkout example:

```json
{
  "mcpServers": {
    "garbro-dev": {
      "command": "node",
      "args": [
        "C:/Users/me/Code/garbro-mcp/packages/mcp/dist/index.js",
        "--input-root", "games=D:/Games",
        "--output-root", "default=D:/garbro-output"
      ]
    }
  }
}
```

Use absolute paths for the server and root directories. If the MCP client cannot find `node`, use
the absolute path to the Node.js executable.

## Filesystem policy

Tools address input files with logical references such as:

```json
{ "rootId": "games", "path": "Rewrite/voice.xp3" }
```

The server rejects:

- absolute input and output paths supplied through tools;
- `..` traversal and paths outside the selected root;
- unknown root IDs;
- symbolic-link escapes;
- unsafe archive entry destinations;
- implicit overwrite of existing files.

Game files below input roots are opened read-only. Extraction writes only below a configured output
root. Use a separate output directory rather than placing output inside the game installation.

The legacy single `--output-root <path>` form is accepted as root ID `default`. With no root
arguments, input root `workspace` maps to the current directory and output defaults to
`garbro-output` below it.

## Check a configuration

Record the exact build:

```powershell
node C:/Tools/garbro-mcp/garbro-mcp.cjs --version --json
```

Then validate the same roots used by the MCP client:

```powershell
node C:/Tools/garbro-mcp/garbro-mcp.cjs `
  --input-root games=D:/Games `
  --output-root default=D:/garbro-output `
  --doctor --json
```

See the [tool reference](tool-reference.md) for the logical source and output-root fields accepted by
individual tools.
