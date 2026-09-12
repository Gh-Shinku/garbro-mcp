# MG SHA archive

## Reference and attribution

- GARBro reference: `ArcFormats/MangaGamer/ArcSHA.cs`, class `PacOpener`
- GARBro tag: `PAC/SHA`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`SHA` archives start with the ASCII signature `SHA_` and an entry count at offset 8. The
index begins at 0x0c and uses 0x50-byte records:

| Offset | Size | Meaning |
| --- | ---: | --- |
| 0x00 | 1 | UTF-8 filename length |
| 0x01 | up to 0x3f | UTF-8 filename |
| 0x40 | 4 | absolute 32-bit offset |
| 0x44 | 4 | 32-bit size |

Unlike most GARbro ports, names are UTF-8 rather than CP932. This port rejects lengths that would
spill into the offset fields, which keeps the record self-consistent.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| UTF-8 filenames | Supported |
| 0x50-byte records | Supported |
| Entry listing and extraction | Supported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
