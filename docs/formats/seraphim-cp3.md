# Seraphim CP3 multi-frame image

## Reference and attribution

- GARBro reference: `ArcFormats/Seraphim/ArcCP3.cs`, class `Cp3Opener`
- GARBro tag: `CP3`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `CP3X` file starts with the signature and a 32-bit frame count at 8; the first frame header sits at
0x2c. Every frame is sized from its own dimensions: a 0x10-byte header plus 32-bit pixels, that is
`width * height * 4 + 0x10` bytes. GARbro keeps a frame only when that size differs from a bare
header, so zero-dimension frames are skipped, yet still advance the walk by their header size.

Frames are named `<archive>#<n padded to 4>`; the width, height, and bit depth of each frame are
exposed as entry metadata while the payload stays untouched.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Dimension-derived frame sizes | Supported |
| Empty frame skipping | Supported |
| Generated frame names | Supported |
| Frame metadata (width, height, bpp) | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Pixel decoding | Not applicable |
| Archive creation | Unsupported |

Synthetic fixtures cover the frame walk, empty frame skipping, generated names, and frame size
rejection.
