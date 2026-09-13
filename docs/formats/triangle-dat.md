# Triangle DAT archive

## Reference and attribution

- GARBro reference: `ArcFormats/Triangle/ArcDAT.cs`, class `DatOpener`
- GARBro tag: `DAT/TRIANGLE`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Triangle archives store a record count at offset 0 and the first data offset at 4, which must
equal `4 + count * 0x11`. Records start at offset 8 and are 0x11 bytes: a 13-byte CP932 name
plus a 32-bit next-offset at +0x0d. GARbro walks `count - 1` records (the final record carries
only a name) and derives each entry size from the neighbouring offsets.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| First-offset validation | Supported |
| 0x11-byte records | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
