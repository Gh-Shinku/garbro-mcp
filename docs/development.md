# Development guide

## Requirements and setup

- Node.js 24 or newer
- pnpm 11

```shell
pnpm install
pnpm build
pnpm check
```

The repository is a private pnpm workspace:

```text
packages/core      bigint binary I/O, format interfaces, registry, safe extraction
packages/codecs    reusable codecs
packages/formats   engine and format implementations
packages/cli       command-line interface
packages/mcp       MCP stdio server
```

Core parsing, decoding, and extraction logic must remain independent of MCP. The MCP package is a
thin protocol adapter over the core APIs. Format implementations should remain modular and
independently testable.

Contributor workflow and commit conventions are defined in [AGENTS.md](../AGENTS.md).

## CLI

After building, invoke the development CLI directly with Node:

```shell
node packages/cli/dist/index.js formats
node packages/cli/dist/index.js detect data.xp3 --json
node packages/cli/dist/index.js list data.xp3
node packages/cli/dist/index.js extract-entry data.xp3 0 --output extracted
node packages/cli/dist/index.js extract-archive data.xp3 --output extracted
```

Extraction refuses to overwrite existing files by default. Add `--overwrite` explicitly to replace
regular files. Absolute archive paths, path traversal, Windows alternate data streams and device
names, and symbolic-link destinations are always rejected.

## Tests and differential validation

```shell
pnpm test
pnpm test:differential -- --archive fixtures/private/sample.xp3 --reference fixtures/private/garbro-output
```

The regular test suite uses deterministic, redistributable synthetic fixtures committed to the
repository. Differential tests compare this project's output with a private reference directory
extracted by GARBro, matching path, size, and SHA-256. `fixtures/private/` is excluded from version
control.

Format-specific sources, implementation details, and limitations belong under `docs/formats/`.
The generated GARBro compatibility baseline and status definitions are documented in
[support.md](support.md).

## Formats that are not ported

Some GARbro formats cannot be reimplemented faithfully, or at all, from the reference sources. They are
recorded here with the reason, so that a later pass does not have to read them again:

| format | reference | why |
| --- | --- | --- |
| `BIN/DXLIB` | `ArcFormats/DxLib/ArcDX8.cs` | dead source: `TryOpen` always returns null, its decryption and decompression are left as `TODO`. The base DXA opener it extends is ported. |
| `AF2` | `ArcFormats/CsWare/AudioAF2.cs` | dead source, noted in `docs/formats/csware-wav-audio.md` as well. |
| `MCP` | `Legacy/Mink/ImageMCP.cs` | the reference source is incomplete. |
| `LPC` | `ArcFormats/Hypatia/ArcLPC.cs` | unimplementable from the reference, which is itself incomplete upstream. |
| `ACV` | `ArcFormats/NonColor/ArcACV.cs` | needs a scheme of unencrypted file names the user has to supply. |
| `DAT/MINATO` | `ArcFormats/NonColor/ArcMinato.cs` | needs the same kind of scheme, with CRC-32 names. |
| `OGG/TINK` | `ArcFormats/Cyberworks/AudioTINK.cs` | needs keys the user has to supply. |
| `RPGMVO`, `RPGMVP` | `Experimental/RPGMaker/AudioRPGMV.cs` | needs a key the user has to supply. |
| `DSM/UNITY` | `ArcFormats/Unity/ArcDSM.cs` | encrypted with Rijndael and a password the user has to supply. |
| `DSM/UTAGE` | `ArcFormats/Unity/ScriptDSM.cs` | the same, with a password of its own. |
| `BYTES/UNITY` | `ArcFormats/Unity/ArcSpVM.cs` | its index is a .NET `BinaryFormatter` stream, a format of its own that this project does not read. |
| `MBM` | `Legacy/Logg/ArcMBM.cs` | needs a file list that lives outside the archive. |
| `S5I` | `ArcFormats/rUGP/ImageS5I.cs` | needs the CRio decompressor. |
| `SPC` | `ArcFormats/Cri/ImageSPC.cs` | needs the XTX codec. |
| `PNG/ISM` | `ArcFormats/Ism/ImagePNG.cs` | needs a portable network graphic decoder, which this project does not have. |
| `JBP` | `ArcFormats/Sviu/ImageJBP.cs` | a lossy transform codec, parked rather than declined. |
| `AIFF` | `ArcFormats/AudioAIFF.cs` | delegates to the NAudio library's own reader. |
| `CAB` | `Experimental/Cabinet/ArcCAB.cs` | delegates to the WiX compression library. |
| `AI5WIN`, `ARC` | `ArcFormats/Elf/ArcAI5Win.cs` and `ArcARC.cs` | need the user's own scheme database, noted in `docs/formats/elf-ai5dat.md`. |
