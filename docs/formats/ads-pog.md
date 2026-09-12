# ads POG audio archive

## Reference and attribution

- GARBro reference: `ArcFormats/Ads/ArcPOG.cs`, class `PogOpener`
- GARBro tag: `060/POG`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`POG` archives start with the bytes `POG` and a NUL, a 32-bit names offset at offset 4, and a
32-bit entry count at offset 8. The offset table starts at 0x10 with one extra sentinel;
sizes are the differences between neighbouring offsets. The name table at the declared offset
starts with four unused bytes and then holds `(length, index, name)` records that assign
CP932 names to the listed entries.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Trailing name table | Supported |
| Derived entry sizes | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
