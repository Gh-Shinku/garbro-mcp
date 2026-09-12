# KeroQ DAT archive

## Reference and attribution

- GARBro reference: `Legacy/KeroQ/ArcDAT.cs`, class `PacOpener`
- GARBro tag: `DAT/PAC`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

KeroQ archives start with the bytes `89 50 41 43` and a 32-bit entry count at offset 4. The
archive file name must be a number; the index lives in the sibling file named after the
previous number (`001.dat` uses `000.dat`). That header file starts with `89 48 44 52`
(`\x89HDR`) plus the same count, followed by records with a 0x10-byte CP932 filename, a 32-bit
size, and a 32-bit offset.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Previous-numbered companion header | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
