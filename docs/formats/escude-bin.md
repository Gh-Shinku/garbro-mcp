# Escu:de ESC-ARC BIN

## Reference and attribution

- GARBro reference: `ArcFormats/Escude/ArcBIN.cs`, class `BinOpener`
- Shared entry decoder: `ArcFormats/Favorite/ArcFVP.cs`
- GARBro tag: `BIN/ESC-ARC`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive begins with `ESC-ARC1` or `ESC-ARC2`, a 32-bit key seed, and an encrypted entry count.
The key generator mutates the seed with XOR and shift operations, producing one word for every
encrypted 32-bit value.

Version 1 encrypts complete 0x88-byte records containing a 0x80-byte CP932 path, absolute offset,
and size. Version 2 encrypts 12-byte records containing a filename-table offset, absolute data
offset, and size; its separate CP932 filename table is not encrypted. Both versions can store
Favorite-compatible `acp\0` entries using variable-width LZW compression.

## Support

| Capability | Status |
| --- | --- |
| ESC-ARC1 and ESC-ARC2 detection | Supported |
| Encrypted counts, sizes, and index records | Supported |
| Fixed and indirect CP932 paths | Supported |
| Raw entry extraction | Supported |
| ACP variable-width LZW decompression | Supported |
| Archive creation | Unsupported |

The implementation is covered by independently generated encrypted v1 and v2 fixtures, raw and ACP
entries, hierarchical paths, and malformed-index tests. It has not been validated against real game
data, following the current migration policy.
