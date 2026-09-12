# Winters IFX archive

## Reference and attribution

- GARBro reference: `ArcFormats/Winters/ArcIFX.cs`, class `IfxOpener`
- GARBro tag: `IFX`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`IFX` files are detected by the `.ifx` extension with a size above 0x10000. The descriptor
table occupies 0x20..0x10000 in 0x10-byte records; a record with a zero 16-bit marker is
skipped. Each valid record stores a 32-bit offset at +0x04 and a 32-bit size at +0x08. Entries
are named `<basename>#NNNNN`.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Fixed descriptor table | Supported |
| Generated entry names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
