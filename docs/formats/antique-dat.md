# An*tique DAT archive

## Reference and attribution

- GARBro reference: `ArcFormats/Antique/ArcDAT.cs`, class `PakOpener`
- GARBro tag: `DAT/ACHV`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`ACHV` archives start with the ASCII signature `ACHV`, a 32-bit entry count at 0x0c, and a
32-bit name-section length at 0x10. The index starts at 0x14 and uses 0x10-byte records with a
32-bit absolute offset and a 32-bit size. Immediately after the index comes a name section of
the declared length holding one null-terminated CP932 name per entry, in index order.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Separate name section | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
