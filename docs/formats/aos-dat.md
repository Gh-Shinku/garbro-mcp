# AOS DAT archive

## Reference and attribution

- GARBro reference: `Legacy/Aos/ArcDAT.cs`, class `DatOpener`
- GARBro tag: `DAT/PACK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`DAT` archives are detected by extension and keep their index in a sibling `index.idx` file.
Index records are a null-terminated CP932 filename (at most 0x34 bytes), a 32-bit offset, and a
32-bit size. An empty name ends the list.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Companion `index.idx` | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
