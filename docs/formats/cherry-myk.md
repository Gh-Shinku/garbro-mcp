# Cherry MYK archive

## Reference and attribution

- GARBro reference: `ArcFormats/Cherry/ArcMyk.cs`, class `DatOpener`
- GARBro tag: `DAT/CHERRY`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`MYK0` and `CHE0` archives carry the 16-bit marker `0x1a30` at offset 4, a 16-bit entry count
at offset 8, and a 32-bit index pointer at 0x0a. Index records are 0x10 bytes with a 12-byte
CP932 name and a 32-bit size at +0x0c; payloads are stored sequentially from offset 0x10.

## Support

| Capability | Status |
| --- | --- |
| Dual signature detection | Supported |
| Version marker validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
