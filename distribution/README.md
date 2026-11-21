# garbro-mcp

Give your MCP client access to the files inside supported visual novel game archives.
You can ask it to find a voice clip, list the images in an archive, or extract a selection
of files. The server opens the game files read-only.

## Connect your MCP client

Install Node.js 24 or newer on the machine that holds the game files. Add this entry to
a client that uses `mcpServers` for stdio servers, then restart the client.

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

On Windows, use `npx.cmd` if your client cannot find `npx`.

## Try it on a game

Give the client an absolute path to a game directory or an archive. For example, replace
the path in this request with your own.

> Scan D:/Games/MyGame for archives containing audio. Show me the archive names and a
> few audio entry paths so I can choose a file to extract.

Once you choose an entry, ask the client to extract it and show you the output path.
The server checks the extracted file's size and SHA-256 and returns a verification
report. Outputs go into a temporary directory and expire after 24 hours by default.
Ask your client to copy any files you want to keep to a folder of your choice.

## Check the installation

If the client cannot start the server, run the same package from a terminal to check
the build and its access to temporary storage.

```shell
npx --yes garbro-mcp@latest --doctor --json
```

[Supported formats](https://github.com/Gh-Shinku/garbro-mcp/blob/main/docs/support.md)
· [Client configuration](https://github.com/Gh-Shinku/garbro-mcp/blob/main/docs/configuration.md)
· [Offline installation](https://github.com/Gh-Shinku/garbro-mcp/blob/main/docs/distribution.md#user-installation)

The format readers use [GARBro](https://github.com/morkt/GARBro) as a reference. The
package includes the project license and bundled dependency notices.
