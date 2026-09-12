# Bishop BSC composite image

## Reference and attribution

- GARBro reference: `ArcFormats/Bishop/ArcBSC.cs`, class `BscOpener`
- GARBro tag: `BSC`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`BSC` files start with `BSS-Composition\0` and a frame count byte at 0x11. Frames start at
0x20 and each frame is a 0x40-byte header followed by a payload whose 32-bit size sits at
header offset 0x36. Frames are named `<basename>#NNN.bsg`.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| 0x40-byte frame headers | Supported |
| Generated BSG names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
