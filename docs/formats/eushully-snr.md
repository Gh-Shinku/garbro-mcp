# Eushully script archive

## Reference and attribution

- GARBro reference: `ArcFormats/Eushully/ArcGPC.cs`, classes `HOpener` and `SnrOpener`
- GARbro tag: `SNR`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

This archive shares the companion-index reader of its graphic sibling, with the same extension rule: the index
name keeps the archive extension's first two letters and appends `h`, so `.snr` is indexed by `.snh` — the same
companion name the audio archive of this family uses.

Two details differ from the graphic variant. Entries keep the names the index stores instead of gaining an
appended extension, and the reference classifies them as scripts, which the port records as metadata. The index
record layout, the inverted name bytes, the offset sorting and the derived sizes are all shared with that
sibling, and payloads are stored verbatim.

## Support

| Capability | Status |
| --- | --- |
| Companion index name derived from the extension | Supported |
| Rejection when the extension is four long or ends in `h` | Supported |
| Inverted name bytes with a one-byte length | Supported |
| Names used as stored | Supported |
| Offset sorting with derived sizes | Supported |
| Case-insensitive companion lookup | Supported as a hardening |
| CP932 names | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a script entry through its companion index.
