# KaGuYa AN10 animation resource

## Reference and attribution

- GARBro reference: `ArcFormats/Kaguya/ArcANM.cs`, classes `AnmOpenerBase` and `An10Opener`
- GARbro tag: `AN10/KAGUYA`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

This version shares the two-count frame table of its 00 sibling — a word at 0x14 locating a four-byte-stride
table, and the real frame count behind it — but its frames begin a 0x14-byte header because a channel word sits
at 0x10. A frame's span is therefore its header plus channels times width times height, so the pixel depth is
read per frame rather than fixed at thirty-two bits.

Frames are named from the archive name and a two-digit index, with depth, width and height recorded as metadata,
and the port checks the derived spans while the reference does not.

The picture of a frame stands of the places of the file of the frame behind the head of it, of one place of a
colour to a pixel, and of the rows of it turned over: `ImageData.CreateFlipped` is what the reference stands of, which
means the last row of the file is the first row of the picture. This port reads the places, turns the rows over and
hands a bitmap over. The place of a frame in the picture of the file itself stands of the place of the file (read at
four) together with the place the frame carries (read at nought).

The picture of a version 10 frame stands of three or of four places of a colour, which the channel word of the frame
decides. The reference hands a frame of any other count over as a picture of four places of a colour with a stride of
its own, which disagrees with the count it declares; such a frame is turned away here.

## Support

| Capability | Status |
| --- | --- |
| `AN10` signature detection | Supported |
| Two-count frame table | Supported |
| Frame headers with a channel word | Supported |
| Derived spans with bound checking | Supported as a hardening |
| Generated two-digit frame names and metadata | Supported |
| Bitmap decoding of a frame: three or four places of a colour to a pixel, rows turned over | Supported |
| Frames of a count of places of a colour the engine knows not, turned away | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a frame with a channel word and the walks of its picture.
