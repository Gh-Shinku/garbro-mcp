# KaGuYa PLT animation resource

## Reference and attribution

- GARBro reference: `ArcFormats/Kaguya/ArcPLT.cs` (`Pl00Opener`) with `ArcFormats/Kaguya/ArcANM.cs`
  (`AnmOpenerBase`)
- GARbro tag: `PLT/KAGUYA`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The signature spells `PL00`, the frame count sits at 4, and the first frame begins at 0x16, behind a base
information block. A frame is a 0x14-byte header followed by its pixels, and the header's depth, width and
height at 8, 0x0C and 0x10 give the image size as their product. That product is the only way to know where
the next frame begins, because the frame sizes are derived rather than stored, so a frame's span is the header
plus that product and the walk advances by it.

Frames carry no names of their own: `AnmOpenerBase.TryOpen` builds them from the archive name and a
two-digit index and classifies every frame as an image. The port records each frame's depth, width and
height as metadata, validates that the derived layout stays inside the file — which the reference leaves
unchecked. The picture of a frame stands of the places of the file behind the head of the frame, of one place of a
colour to a pixel, and of the rows of it turned over: `Pl00Decoder` stands of `ImageData.CreateFlipped` through the
shared walk of the animation resources of this engine, so the last row of the file is the first row of the picture. The
reference stands of three places of a colour as a picture of three of them and of every other count as a picture of
four, whose stride would not stand of the count it declares; a frame of any other count stands turned away here.

The `PL10` variant declared in the same GARbro file is a separate format with its own tag, and it is not part
of this port: its first frame is stored raw while later frames carry a step byte and a packed size ahead of
RLE-compressed pixels.

## Support

| Capability | Status |
| --- | --- |
| `PL00` signature detection | Supported |
| Frame count validation | Supported |
| Frames from 0x16 with a 0x14-byte header | Supported |
| Sizes derived from depth, width and height | Supported |
| Generated two-digit frame names | Supported |
| Frame metadata (depth, width, height, image size) | Supported |
| Derived-span bound checking | Supported as a hardening |
| Bitmap decoding of a frame: three or four places of a colour to a pixel, rows turned over | Supported |
| Frames of a count of places of a colour the engine knows not, turned away | Supported |
| `PL10` variant | Not ported |
| Archive creation | Unsupported |

Synthetic fixtures cover two frames of different depths, a foreign signature, an empty frame count, and a
frame whose declared width makes its span leave the file.
