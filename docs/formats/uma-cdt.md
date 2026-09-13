# Uma CDT archive

## Reference and attribution

- GARBro reference: `Legacy/Uma/ArcCDT.cs`, class `CdtOpener`
- GARBro tag: `CDT/UMA`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`CDT` and `SPT` archives are a flat chain of records: a null-terminated CP932 name (at most
0x10 bytes), a 32-bit unpacked size, a 32-bit packed size, a 32-bit packed flag, and the
payload. Packed payloads use the default GARbro LZSS variant.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Sequential record walk | Supported |
| Default LZSS decompression | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
