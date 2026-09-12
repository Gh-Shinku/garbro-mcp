# Tetratech BND archive

## Reference and attribution

- GARBro reference: `Legacy/Tetratech/ArcBND.cs`, class `BndOpener`
- GARBro tag: `BND/IDX`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`BND` archives are detected by extension and keep their index in a sibling `.idx` file. The
index size must be a non-zero multiple of 0x18 and records hold a 0x10-byte CP932 filename, a
32-bit size, and a 32-bit offset.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Companion `.idx` index | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
