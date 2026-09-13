# origin engine GAF bitmap archive

## Reference and attribution

- GARBro reference: `ArcFormats/Origin/ArcGAF.cs`, class `GafOpener`
- GARBro tag: `GAF/ORIGIN`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive must be named `gaf` and stores the frame width and height at 0 and 4, both within 1 and
0x4000, plus a record count at 8. Frames begin at 0x0c and carry no offsets or sizes: each frame is a
chain of two-byte RLE steps whose second byte adds to a pixel count, and GARbro keeps walking until
that count covers `width * height`. The final frame simply runs to the end of the file.

Because the frame size follows from its own stream, the port walks the RLE steps in memory instead of
issuing one read per step, and exposes the stored dimensions and depth as entry metadata while
extracting frames raw.

## Support

| Capability | Status |
| --- | --- |
| File name detection | Supported |
| Dimension validation | Supported |
| RLE-step frame sizing | Supported |
| Final frame running to EOF | Supported |
| Image metadata (width, height, bpp) | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Frame decoding | Not applicable |
| Archive creation | Unsupported |

Synthetic fixtures cover the step walk, the trailing frame, file name rejection, incomplete chains,
and dimension limits.
