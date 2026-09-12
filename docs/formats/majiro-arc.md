# Majiro ARC

## Reference and attribution

- GARBro reference: `ArcFormats/Majiro/ArcMajiro.cs`, class `ArcOpener`
- GARBro tag: `MAJIRO`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2014 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Majiro archives begin with `MajiroArcV1.000\0`, `MajiroArcV2.000\0`, or `MajiroArcV3.000\0`.
The header gives the entry count, names offset, and data offset. A sequential null-terminated CP932
name table sits between the fixed index and entry data.

Version 1 stores 32-bit name hashes and offsets, with one extra sentinel record supplying the final
offset; sizes are differences between adjacent offsets. Version 2 stores a 32-bit hash, offset, and
size per record. Version 3 expands the hash to 64 bits. Entry data is raw in all three versions.

## Support

| Capability | Status |
| --- | --- |
| Versions 1, 2, and 3 | Supported |
| CP932 filenames | Supported |
| 32-bit and 64-bit name hashes | Supported |
| Sentinel and explicit-size indexes | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover all three versions, both size schemes, CP932 names, and malformed section
offsets. No real game data is used, following the current migration policy.
