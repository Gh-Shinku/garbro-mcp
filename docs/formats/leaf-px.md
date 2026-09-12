# Leaf PX multi-frame image

## Reference and attribution

- GARBro reference: `ArcFormats/Leaf/ArcPX.cs`, class `PxOpener`
- GARBro tag: `PX/LEAF`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`PX` files have no magic signature beyond a 16-bit marker at 0x10 equal to 0x80 and the ASCII
tag `Leaf` at 0x14. A 32-bit frame count sits at offset 0 and the frame index starts at 0x20
with one 32-bit base-relative offset per frame. Frames are named `<basename>#0000`, `#0001`,
...; each frame ends where the next one starts, and the final frame ends at the end of file.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| Derived frame sizes | Supported |
| Generated frame names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
