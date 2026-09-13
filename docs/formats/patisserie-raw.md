# Patisserie RAW animation

## Reference and attribution

- GARBro reference: `ArcFormats/Patisserie/ArcRAW.cs`, class `RawOpener`
- GARBro tag: `ABB/RAW`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2017 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `RAW\x04` file stores the length of its frame area at 4, relative to offset 8. Frames follow at 8
and every frame is sized from its own dimensions: a 0x14-byte header plus 32-bit pixels, that is
`0x14 + width * height * 4` bytes. The walk ends at the declared frame area end, which GARbro
requires to stay inside the file.

Frames are named after their position, padded to four digits; placement, width, height, and bit
depth are exposed as entry metadata.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Dimension-derived frame sizes | Supported |
| Declared frame area end | Supported |
| Generated frame names | Supported |
| Frame metadata (width, height, bpp) | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Pixel decoding | Not applicable |
| Archive creation | Unsupported |

Synthetic fixtures cover the frame walk, generated names, and frame area rejection.
