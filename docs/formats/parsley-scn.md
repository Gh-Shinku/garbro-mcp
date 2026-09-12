# Software House Parsley SCN archive

## Reference and attribution

- GARBro reference: `ArcFormats/Software House Parsley/ArcScn.cs`, class `ScnDatOpener`
- GARBro tag: `DAT/SCN`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2017 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The scenario archive is detected by its file name: only `scn.dat` is accepted. The first 0x1400
bytes hold the index and the payload area begins at 0x1400. Records are 0x28 bytes with a
null-terminated CP932 filename, a 32-bit offset at +0x20 relative to 0x1400, and a 32-bit size at
+0x24. The record walk stops at the first zero byte or when 0x1400 bytes have been consumed.

## Support

| Capability | Status |
| --- | --- |
| File-name detection | Supported |
| Fixed 0x1400 index area | Supported |
| Base-relative offsets | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
