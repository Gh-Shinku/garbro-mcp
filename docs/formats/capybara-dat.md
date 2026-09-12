# CAPYBARA DAT archive

## Reference and attribution

- GARBro reference: `ArcFormats/Winters/ArcDAT.cs`, class `DatOpener`
- GARBro tag: `DAT/CAPYBARA`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`CAPYBARA DAT 001` archives store a 32-bit names offset at 0x10 and a 32-bit names length at
0x14. The index at 0x18 holds one 32-bit offset and one 32-bit size per entry until the names
offset is reached. The name section is a CP932 line list terminated by `:END`; entries are
consumed in index order.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Line-based CP932 name list | Supported |
| `:END` terminator | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
