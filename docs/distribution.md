# Distribution

The independent release manifest in `distribution/package.json` publishes a self-contained npm
package. Internal workspace packages remain private and are bundled into the release artifact.
GitHub releases include a portable ZIP of the same server.

## User installation

Install Node.js 24 or newer. For the shortest setup, run a pinned npm version:

```shell
npx --yes garbro-mcp@<version> --version
npx --yes garbro-mcp@<version>
```

The second command starts the MCP server on stdio and waits for an MCP client. A client
configuration can use `npx` with `--yes` and `garbro-mcp@<version>` as arguments. On Windows, use
`npx.cmd` if the client does not resolve command shims. Pinning avoids unreviewed automatic updates.

Alternatively, download the portable ZIP and matching `SHA256SUMS` from a specific
[GitHub release](https://github.com/Gh-Shinku/garbro-mcp/releases). Use the asset named
`garbro-mcp-<version>-portable.zip`.

Verify the ZIP's hash against its line in `SHA256SUMS`:

```shell
sha256sum garbro-mcp-<version>-portable.zip
```

On Windows:

```powershell
Get-FileHash ./garbro-mcp-<version>-portable.zip -Algorithm SHA256
```

Checksums detect incomplete or modified downloads; they are not a separate authenticity signature.
Extract the ZIP, then configure the client to run
`node /absolute/path/garbro-mcp/garbro-mcp.cjs`. Game paths are supplied in tool tasks. Use an
absolute Node executable path if the client does not inherit Node's PATH. No runtime dependency
installation or registry access is needed. All three desktop operating systems use the same
bundle. Optional temporary-workspace settings are documented in
[configuration.md](configuration.md).

The package can also be installed globally from npm:

```shell
npm install --global garbro-mcp@<version>
garbro-mcp --version --json
```

Alternatively, download the `.tgz` and install it offline:

```shell
npm install --global /absolute/path/garbro-mcp-<version>.tgz
garbro-mcp --version --json
```

The tarball contains the same bundle, has no runtime dependencies or installation scripts, and
can be installed offline. Global installation requires a writable npm prefix. Configure the MCP
client with `garbro-mcp` (or its absolute executable path).

Keep versions in separate directories. Updating or rolling back is an explicit path change and
client restart; the server does not download updates or follow `main` automatically.

## Build and verify locally

From an installed development checkout:

```shell
pnpm build:release --version 0.1.0-experimental.1
pnpm test:release --version 0.1.0-experimental.1
```

Without a version argument, both commands use the version in `distribution/package.json`.
The build generates these ignored artifacts under `dist/release/`:

- `garbro-mcp-<version>-portable.zip`: portable directory containing the bundle, manifest, README,
  project license, and full bundled dependency license texts.
- `garbro-mcp-<version>.tgz`: npm-installable package with the same files.
- `garbro-mcp-<version>-build.json`: build ID, version, source commit, build time, format-catalog
  hash, dirty-tree flag, and bundled dependency versions/licenses.
- `garbro-mcp-<version>-SHA256SUMS`: hashes for the three artifacts above.

esbuild bundles internal workspace packages and third-party runtime dependencies. The build rejects
remaining non-Node external imports and missing bundled dependency license files. The runtime does
not read source files, support documents, or `node_modules` from the checkout.

The verification command checks hashes, extracts the ZIP into a temporary directory, and installs
the tarball using npm's offline mode with an empty cache. It starts each bundle through actual MCP
stdio from an unrelated working directory, verifies the build identity and doctor command, all
tools, planning, CP932 decoding, extraction and verification hashes, progress notifications,
conflict skipping, and path confinement, then removes the temporary test directories. It also
verifies npm's generated executable and identical package contents.

## CI releases

On pushes to `main`, **Prepare or publish releases** runs the Linux and Windows checks. Release
Please uses Conventional Commits across the repository to open or update one version PR for
`garbro-mcp`. Review the version, changelog, and checks before merging that PR. The first
release on the npm `latest` channel under this policy is `0.1.0`. Each subsequent release
increments the patch number by one, including releases with features or breaking changes.
For example, `0.1.99` is followed by `0.1.100`. Moving to another version line requires
a maintainer decision and an update to the publish script's version check.

### Set up publication

1. Allow GitHub Actions to create pull requests in the repository's Actions settings, or provide
   a repository secret named `PAT_TOKEN` with repository contents, issues, and pull request
   write access. The workflow falls back to `GITHUB_TOKEN`. If the bot PR has no checks,
   dispatch **Check** on its head branch and verify the tested SHA.
2. In npm's Trusted Publisher settings for `garbro-mcp`, select GitHub Actions and enter owner
   `Gh-Shinku`, repository `garbro-mcp`, and workflow filename `publish.yml`. Leave the environment
   blank. The publish job authenticates through OIDC.
3. Set the Actions **variable** `NPM_PUBLISH_ENABLED` to `true` before merging the version PR
   intended for publication. With the variable unset, CI still prepares the version PR.

Merging the version PR with publication enabled creates a tag such as `v0.1.0` and a
draft GitHub release. CI builds once at the tagged commit, then tests the same ZIP and npm
tarball on Linux, Windows, and macOS. It uploads the four assets to the draft, publishes the
tested tarball to npm with provenance, and makes the GitHub release public.

If publication fails, rerun the failed jobs of the original run to reuse its tested artifacts.
CI skips existing npm versions and GitHub assets only when their digests match. Rebuilding can
change the build timestamp and archive bytes. A later push to `main` cannot publish the old tag.

See the [npm Trusted Publisher setup](https://docs.npmjs.com/trusted-publishers/) and
[Release Please Action documentation](https://github.com/googleapis/release-please-action).

## Manual experimental builds

Run **Experimental release** in GitHub Actions with a new prerelease version such as
`0.1.0-experimental.1`:

1. Leave `publish` unchecked to build and test artifacts without publishing.
2. Download the workflow artifact to review or share the candidate.
3. When ready, run on `main` with `publish` checked. Only after build/tests and Linux, Windows, and
   macOS artifact smoke checks pass does the workflow create a GitHub prerelease at the tested
   commit. Existing tags are rejected rather than overwritten or reused.

Use the `experimental.N` suffix for these GitHub-only builds so their tags stay distinct from the
automated `0.1.x` releases.
