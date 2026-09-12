# RSystem RAD multi-frame image

## Reference and attribution

- GARBro reference: `Legacy/RSystem/ArcRAD.cs`, class `RadOpener`
- GARBro tag: `RAD`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`RAD` files are detected by extension. A 32-bit frame count sits at offset 0 and the frame
index starts at 4 with one 32-bit absolute offset per frame. Each frame spans from its own
offset to the next one; the last frame ends at the end of file. Frames are named
`<basename>#NNN`.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Derived frame sizes | Supported |
| Generated frame names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
