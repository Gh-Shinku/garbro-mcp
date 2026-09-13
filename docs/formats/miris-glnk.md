# Studio Miris GLNK archive

## Reference and attribution

- GARBro reference: `ArcFormats/Eternity/ArcGLNK.cs`, class `GlnkOpener`
- GARBro tag: `GLNK/MIRIS`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `GLNK` archive starts with the ASCII signature, a 16-bit version at 4, a 32-bit record count at
6, the index offset at 0x0a, and the index length at 0x0e. Each record holds a byte-sized name
length, a CP932 name, a 32-bit data offset, and a 32-bit size. The record tail is 12 bytes from
version 0x6e and 8 bytes below it, so GARbro advances past the offset and size fields plus four
extra bytes on newer archives.

The index length acts as a budget: GARbro decrements it by `1 + name_length + record_tail` per
record and rejects the archive once it is exhausted or a data range fails the placement check.
Stored extensions are `dat`, `glk`, `mlk`, `slk`, `gl`, `ml`, `sl`, `ets`, `etg` and `etm`.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Version-dependent record tails | Supported |
| Index length accounting | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover both record widths, the index length budget, and payload extraction.
