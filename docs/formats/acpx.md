# Favorite View Point ACPXPK

## Reference and attribution

- GARBro reference: `ArcFormats/Favorite/ArcFVP.cs`, class `BinOpener`
- GARBro tag: `BIN/ACPXPK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive begins with either `ACPXPK01` or `ACP_PK.1`, followed by a little-endian entry count.
Each 0x28-byte index record contains a 0x20-byte CP932 path, absolute data offset, and stored size.
Backslash-separated paths are exposed as portable hierarchical paths.

Entries beginning with `acp\0` contain a big-endian unpacked size and an MSB-first variable-width
LZW stream. Tokens select literals, previously emitted dictionary ranges, an end marker, a width
increase, or a dictionary reset. Dictionary copies use overlapping semantics.

## Support

| Capability | Status |
| --- | --- |
| Both archive signatures | Supported |
| CP932 hierarchical paths | Supported |
| Raw entry extraction | Supported |
| ACP variable-width LZW decompression | Supported |
| Archive creation | Unsupported |

The implementation is covered by synthetic raw and compressed entries, both signatures, dictionary
copying, and malformed-token checks. It has not been validated against real game data, following
the current migration policy.
