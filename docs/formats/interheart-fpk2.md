# Interheart FPK 2.00 archive

## Reference and attribution

- GARBro reference: `ArcFormats/Interheart/ArcFPK2.cs`, class `Fpk2Opener`
- GARBro tag: `FPK/2.00`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`FPK` 2.00 archives start with the ASCII signature `FPK ` followed by the version tag `2.00`.
A 32-bit entry count sits at 0x1c and the index starts at 0x20 with 0x20-byte records holding a
32-bit offset, a 32-bit size, and a 0x18-byte CP932 filename at +8. GARbro skips records whose
name begins with `/` (directory placeholders).

## Support

| Capability | Status |
| --- | --- |
| Signature and version detection | Supported |
| Directory placeholder skipping | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
