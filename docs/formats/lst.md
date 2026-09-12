# Nexton LikeC LST

## Reference and attribution

- GARBro reference: `ArcFormats/Tactics/ArcLST.cs`, class `LstOpener`
- GARBro tag: `LST`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The data file has no signature or embedded index. Its companion index is the data path with `.lst`
appended. The Moon layout XORs its count, offsets, sizes, and 0x24-byte CP932 names with `0xCC` and
uses 0x2C-byte records.

The Nexton layout derives its single-byte XOR key from byte 3 of the encoded count and uses 0x4C-byte
records with 0x40-byte names. A type field maps entries to LST, SNX, BMP, PNG, WAV, or OGG
extensions. SNX script contents use one additional XOR key value.

## Support

| Capability | Status |
| --- | --- |
| Companion-file detection | Supported |
| Moon and Nexton index layouts | Supported |
| XOR-decoded CP932 filenames | Supported |
| Type-to-extension mapping | Supported |
| Raw entry extraction | Supported |
| SNX script decoding | Supported |
| Archive creation | Unsupported |

Synthetic sibling files exercise both layouts through the default registry, including CP932 names,
type mapping, and script decoding. No real game data is used, following the current migration
policy.
