# Aaru FL2.0 archive

## Reference and attribution

- GARBro reference: `Legacy/Aaru/ArcFL2.cs`, class `Fl2Opener`
- GARBro tag: `FL2/AARU`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`FL2.0` archives store a 16-bit data offset at 6, a 16-bit entry count at 8, a 32-bit index
size at 0x0c, and a 32-bit index offset at 0x10. Index records are a 32-bit size, a one-byte
name length, and a null-terminated CP932 name; a size of `0xffffffff` ends the list. Payloads
are stored sequentially from the data offset.

Extraction mirrors GARbro's `FL4Opener`: `PD2A` payloads are LZSS-compressed with a 16-byte
header, `PD` payloads use a 10-byte header, and `RD1.0` payloads use the Aaru RLE stream with
the data offset at +6 and the chunk count at +0x0a. Other payloads are raw.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Variable-length index records | Supported |
| PD2A and PD LZSS decompression | Supported |
| RD1.0 RLE decompression | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
