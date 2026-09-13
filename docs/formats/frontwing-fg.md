# FrontWing FG multi-layer image

## Reference and attribution

- GARBro reference: `ArcFormats/FrontWing/ArcFG.cs`, class `FgOpener`
- GARBro tag: `FG`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `FWGI` file is a container of layered bitmaps. Records start at 4 and are 0x1ac bytes wide; the
walk continues while the leading 32-bit marker of a record equals one. A record stores the layer
placement at +8 and +0x0c, the layer size at +0x18 and +0x1c, a 0x104-byte name field at +0x20, and
the offset and size of the bitmap at +0x124 and +0x128.

GARbro adds four to the stored offset, which skips a small prefix in front of each layer, and keeps
only the file name of the stored name field. Layer placement and pixel size are exposed as entry
metadata; the bitmap itself is extracted unchanged.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| 0x1ac-byte layer records | Supported |
| Name directory stripping | Supported |
| Layer metadata (placement, size, bpp) | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Bitmap decoding | Not applicable |
| Archive creation | Unsupported |

GARbro's image decoder only re-reads the embedded bitmap metadata and applies the stored placement;
the extracted bytes are the same either way.

Synthetic fixtures cover the record walk, name stripping, metadata, and placement rejection.
