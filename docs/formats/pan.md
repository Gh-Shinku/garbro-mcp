# Pan engine archive

## Reference and attribution

- GARBro reference: `Legacy/Pan/ArcPAN.cs`, class `PanOpener`
- GARBro tag: `PAN`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`Pan ver 1.00` archives store a 32-bit entry count at 0x10 and place the index at the end of
the file, sized `count * 0x2c`. Each record holds a 0x20-byte CP932 name, a 32-bit unpacked
size at +0x20, a 32-bit offset at +0x24, and a 32-bit packed size at +0x28. Every entry is
LZSS-compressed with the default GARbro variant.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Trailing index | Supported |
| Default LZSS decompression | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
