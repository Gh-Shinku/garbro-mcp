# U-Me Soft MGX multi-frame image

## Reference and attribution

- GARBro reference: `ArcFormats/UMeSoft/ArcMGX.cs`, class `MgxOpener`
- GARbro tag: `MGX`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The signature spells `MGX` and ends with a 0x1A byte, the frame count sits at 4, and the index that follows
is nothing but one offset per frame. Frames carry no names of their own: the reference builds them from the
archive name as a four-digit index with an upper-case `GRX` extension, and classifies every frame as an
image.

Sizes are derived from consecutive offsets, with the last frame running to the end of the file. The
reference performs no placement check on those derived spans while the port validates each one, and an
offset beyond the file rejects the archive. Frames are extracted verbatim, since decoding them is an image
concern; the frame metadata that GARBro's `MgxMetaData` would derive is likewise out of scope here.

## Support

| Capability | Status |
| --- | --- |
| `MGX` signature with its trailing byte | Supported |
| Frame count validation | Supported |
| Offset index with derived sizes | Supported |
| Generated frame names with the upper-case extension | Supported |
| Offset bound and placement validation | Supported |
| Image classification as metadata | Supported |
| Verbatim extraction | Supported |
| Frame decoding and metadata | Not ported |
| Archive creation | Unsupported |

Synthetic fixtures cover derived names and sizes, a foreign signature, an offset beyond the file, and an
empty frame count.
