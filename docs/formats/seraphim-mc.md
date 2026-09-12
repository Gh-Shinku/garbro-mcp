# Seraphim MC animation

## Reference and attribution

- GARBro reference: `ArcFormats/Seraphim/ArcMC.cs`, class `McOpener`
- GARBro tag: `MC/SERAPH`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`MC` animation files have a structural signature: a zero 32-bit word at offset 0, the ASCII
tag `MC` at offset 4, a 32-bit frame count at offset 8, and a 32-bit payload size at 0x10 that
must equal the file size minus 0x14. Frames start at 0x14 and each frame is a 32-bit size
followed by that many bytes. Frames are named `<basename>#0000.cb`, `#0001.cb`, ...

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| Size-prefixed frames | Supported |
| Generated frame names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
