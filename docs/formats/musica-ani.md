# Musica engine ANI animation resource

## Reference and attribution

- GARBro reference: `ArcFormats/Musica/ArcANI.cs`, class `AniOpener`
- GARBro tag: `ANI/PAZ`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive starts with the version word 0x100, a 16-bit frame count, and a reserved word that must be
zero. Frames follow from offset 8: the index side holds a NUL-terminated frame name, and the entry
itself begins behind it with a ten-byte header holding the width, the height, the bit depth, and four
unused bytes, followed by the pixel data.

The frame size is `width * height * depth / 8 + 10`, so the next frame's name starts right behind the
data and no separate offset table exists. Entries are named `<archive>#<frame name>`, and the port
exposes the stored dimensions and depth as entry metadata while extracting the header and pixels raw.

## Support

| Capability | Status |
| --- | --- |
| Version and reserved word detection | Supported |
| NUL-terminated frame names | Supported |
| Dimension-derived frame sizes | Supported |
| Sequential frame walk | Supported |
| Frame metadata (width, height, bpp) | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Frame decoding | Not applicable |
| Archive creation | Unsupported |

Synthetic fixtures cover the frame walk, the derived sizes, version rejection, reserved word
rejection, and frame range rejection.
