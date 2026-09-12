# Winters CFP archive

## Reference and attribution

- GARBro reference: `ArcFormats/Winters/ArcCFP.cs`, class `CfpOpener`
- GARBro tag: `CFP/CAPYBARA`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`CAPYBARA DAT 002` archives store a 32-bit names offset at 0x14 and a 32-bit names length
at 0x18. The index starts at 0x20 with 0x0c-byte records (a 32-bit offset, a 32-bit size, and
four unused bytes) and the walk ends where the names section starts. The name section is a
CP932 line list; empty lines leave the corresponding index slot unnamed.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Line-based CP932 name list | Supported |
| 0x0c-strided index | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
