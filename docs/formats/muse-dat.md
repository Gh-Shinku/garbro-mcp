# Muse DAT archive

## Reference and attribution

- GARBro reference: `Legacy/Muse/ArcDAT.cs`, class `DatOpener`
- GARBro tag: `DAT/MUSE`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`MUSE` archives start with the ASCII signature `MUSE` and a 16-bit entry count at 0x10. The
index starts at 0x16 and uses 0x10b-byte records:

| Offset | Size | Meaning |
| --- | ---: | --- |
| 0x000 | 2 | unknown |
| 0x002 | 4 | size |
| 0x006 | 1 | unknown |
| 0x007 | 4 | absolute offset |
| 0x00b | 0x100 | null-terminated CP932 filename |

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| 0x10b-strided index | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
