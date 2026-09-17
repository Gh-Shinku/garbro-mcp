# Experimental distribution

Registry publication is not enabled. Workspace packages and the independent release manifest in
`distribution/package.json` remain private. GitHub prereleases distribute a fixed-version,
self-contained Node.js server while the interfaces are still evolving.

## User installation

Install Node.js 24 or newer. Download the portable ZIP and matching `SHA256SUMS` from a specific
[GitHub release](https://github.com/Gh-Shinku/garbro-mcp/releases). These assets must be uploaded by a
maintainer first; GitHub's automatically generated source archives are not portable builds.

Verify the ZIP's hash against its line in `SHA256SUMS`:

```shell
sha256sum garbro-mcp-<version>-portable.zip
```

On Windows:

```powershell
Get-FileHash ./garbro-mcp-<version>-portable.zip -Algorithm SHA256
```

Checksums detect incomplete or modified downloads; they are not a separate authenticity signature.
Extract the ZIP, then configure the client to run `node /absolute/path/garbro-mcp/garbro-mcp.cjs`
with the root arguments described in [mcp.md](mcp.md). Use an absolute Node executable path if the
client does not inherit Node's PATH. No runtime dependency installation or registry access is
needed. All three desktop operating systems use the same bundle.

Alternatively, download the `.tgz` and install it locally:

```shell
npm install --global /absolute/path/garbro-mcp-<version>.tgz
garbro-mcp-server --version
```

The tarball contains the same bundle, has no runtime dependencies or installation scripts, and
can be installed offline. Global installation requires a writable npm prefix. Configure the MCP
client with `garbro-mcp-server` (or its absolute executable path) and the same root arguments.

Keep versions in separate directories. Updating or rolling back is an explicit path change and
client restart; the server does not download updates or follow `main` automatically.

## Build and verify locally

From an installed development checkout:

```shell
pnpm build:release --version 0.1.0-experimental.1
pnpm test:release --version 0.1.0-experimental.1
```

Without a version argument, both commands use `0.0.0-dev.0` from `distribution/package.json`.
The build generates these ignored artifacts under `dist/release/`:

- `garbro-mcp-<version>-portable.zip`: portable directory containing the bundle, manifest, README,
  project license, and full bundled dependency license texts.
- `garbro-mcp-<version>.tgz`: npm-installable package with the same files.
- `garbro-mcp-<version>-build.json`: version, source commit, and bundled dependency versions/licenses.
- `garbro-mcp-<version>-SHA256SUMS`: hashes for the three artifacts above.

esbuild bundles internal workspace packages and third-party runtime dependencies. The build rejects
remaining non-Node external imports and missing bundled dependency license files. The runtime does
not read source files, support documents, or `node_modules` from the checkout.

The verification command checks hashes, extracts the ZIP into a temporary directory, and installs
the tarball using npm's offline mode with an empty cache. It starts each bundle through actual MCP
stdio from an unrelated working directory, verifies all seven tools, CP932 decoding, extraction
hashes, progress notifications, conflict skipping, and path confinement, then removes the temporary
test directories. It also verifies npm's generated executable and identical package contents.

## Manual prerelease workflow

Run **Experimental release** in GitHub Actions with a new prerelease version such as
`0.1.0-experimental.1`:

1. Leave `publish` unchecked to build and test artifacts without publishing.
2. Download the workflow artifact to review or share the candidate.
3. When ready, run on `main` with `publish` checked. Only after build/tests and Linux, Windows, and
   macOS artifact smoke checks pass does the workflow create a GitHub prerelease at the tested
   commit. Existing tags are rejected rather than overwritten or reused.

The workflow never invokes registry publication. For eventual registry distribution, review the
package name and license metadata, remove the release manifest's private guard deliberately, and
publish the same built package through a separately authorized workflow. Internal workspace
packages need not be published independently.
