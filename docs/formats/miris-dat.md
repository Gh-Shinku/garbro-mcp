# Studio Miris DAT archive

## Reference and attribution

- GARBro reference: `ArcFormats/Eternity/ArcMiris.cs`, class `DatOpener`
- GARBro tag: `DAT/MIRIS`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`DAT` archives are detected by extension and keep a zlib-compressed text index in a sibling
file whose name is the archive base name plus `l.dat` (`data.dat` uses `datal.dat`). The text
is CP932 and contains `name,size,offset#` records that this port parses in order.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Zlib-compressed text index | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
