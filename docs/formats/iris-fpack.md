# Iris FPACK archive

## Reference and attribution

- GARBro reference: `Legacy/Iris/ArcFPACK.cs`, class `DatOpener`
- GARBro tag: `DAT/FPACK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`FPACK` archives start with the ASCII signature `FPACK` and a NUL byte, a 16-bit entry count
at offset 6, and a 32-bit total size at offset 8 that must equal the file size. The index starts
at 0x10 and uses 0x18-byte records with a 0x10-byte CP932 filename, a 32-bit offset at +0x10,
and a 32-bit size at +0x14.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Total-size validation | Supported |
| 16-bit entry count | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
