# D.O. animation resource

## Reference and attribution

- GARBro reference: `ArcFormats/Ikura/ArcTAN.cs`, class `TanOpener`
- GARBro tag: `TAN/DO`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Only `.tan` files qualify. A 16-bit frame count at 0 sizes the first index, which GARbro only skips
over. The image metadata follows with the width and height in 16-bit fields, a 0x400-byte palette, and
a second 16-bit frame count that sizes the actual frame offset table.

Frame offsets are relative to the end of that table, and GARbro derives each frame size from the next
offset, letting the last frame run to the end of the file. Frames are eight-bit images named
`<archive>#<n padded to 2>`; the port exposes the stored dimensions and bit depth as entry metadata
and extracts frames raw.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Skipped first index | Supported |
| Image metadata (width, height, bpp) | Supported |
| Palette block handling | Supported |
| Second frame index with relative offsets | Supported |
| Derived frame sizes | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Frame decoding | Not applicable |
| Archive creation | Unsupported |

Synthetic fixtures cover the metadata block, the frame index, derived sizes, extension rejection, and
frame count rejection.
