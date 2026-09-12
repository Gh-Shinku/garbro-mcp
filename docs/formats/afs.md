# CRI AFS

## Reference and attribution

- GARbro reference: `ArcFormats/Cri/ArcAFS.cs`, class `AfsOpener`
- GARbro tag: `AFS`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2014-2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on the documented structure and
GARbro behavior.

## Structure

An AFS archive begins with `AFS\0` and a little-endian entry count. Each eight-byte index record
contains a 32-bit data offset and size. The filename table begins at the end of the final indexed
entry rounded up to a `0x800`-byte boundary. Its `0x30`-byte records begin with a null-terminated,
`0x20`-byte CP932 filename.

Entry data is stored without archive-level compression or encryption.

## Support

| Capability | Status |
| --- | --- |
| Signature and structural detection | Supported |
| CP932 filename table | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

The implementation is covered by synthetic archives and malformed-boundary tests. It has not been
validated against real game data, following the current migration policy.
