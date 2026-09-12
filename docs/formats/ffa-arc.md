# FFA System ARC archive

## Reference and attribution

- GARBro reference: `ArcFormats/Ffa/ArcFFA.cs`, class `ArcOpener`
- GARBro tag: `FFA/ARC`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

FFA archives carry one of three headers (`M2TYPE_WAV`, `M2T_BMP`, `M2T_WORD`) and place their
index just before a 0x14-byte tail. The tail stores the index size at `size - 12` and the entry
count at `size - 8`; the index starts at `size - 0x14 - indexSize` and uses 0x18-byte records
with a 0x10-byte CP932 name, a 32-bit offset at +0x10, and a 32-bit size at +0x14.

## Support

| Capability | Status |
| --- | --- |
| Header detection | Supported |
| Trailing index pointer | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
