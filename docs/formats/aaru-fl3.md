# Aaru FL3.0 archive

## Reference and attribution

- GARBro reference: `Legacy/Aaru/ArcFL3.cs`, class `Fl3Opener`
- GARBro tag: `FL3/AARU`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`FL3.0` archives store a 16-bit data offset at 8, a 32-bit index size at 0x0a, a 32-bit index
offset at 0x0e, and a 32-bit entry count at 0x12. The record layout and the compression
variants (`PD2A`, `PD`, `RD1.0`) match the FL2.0 implementation, which GARbro shares through
`Fl4Opener`.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| 32-bit entry count | Supported |
| PD2A and PD LZSS decompression | Supported |
| RD1.0 RLE decompression | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
