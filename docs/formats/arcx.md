# ARCX archive

## Reference and attribution

- GARBro reference: `ArcFormats/ArcARCX.cs`, class `ArcOpener`
- GARBro tag: `ARCX`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`ARCX` archives start with the ASCII signature `ARCX` and a 32-bit entry count at offset 4.
The index starts at 0x10 with 100-byte CP932 names followed by 0x1c-byte data records: a
32-bit offset, a 32-bit packed size, a 32-bit unpacked size, and a packed flag at +0x13.
Packed entries use the default LZSS variant.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| 100-byte names | Supported |
| Default LZSS decompression | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
