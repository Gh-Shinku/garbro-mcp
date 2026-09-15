# Discovery AN1 animation

Reference: `GARbro/Legacy/Discovery/ImageAN1.cs`, classes `An1Format` and `AnReader` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/discovery/an1-image.ts` (`discoveryAn1ImageDescriptor`,
`discoveryAn1ImageFormat`, id `discovery-an1-image`). The still picture of the same engine is ported beside it as
`discovery-pr1-image`; the header, the colour map, the planes and the flattening are the same reader, and the port
shares them rather than writing them twice.

The reference keeps the export of this format **commented out**, so its own catalogue never offers it and its
reader is never reached by extension or by signature. The port keeps that quiet in the same way: the descriptor
declares no signature hint and no extension fallback, and the reader checks for the `.AN1` extension itself, so
nothing is found by accident and the format is reached only by asking for it.

## The frame table

An animation is a strip of frames that are thirty two pixels square. The count of them is **not** in the file
header but in the first of the four planes, as the little-endian word at its third and fourth byte — which the
decode of the planes has to be finished before it can be read.

| offset | field |
|---|---|
| 0 | what the picture reader makes of the header; the measurements in it are the still picture's |
| count·0x16 + 6 | the plane byte the frames begin at |
| 4·count·0x20 | the plane byte they end at, since one row of a frame takes four of them |

The picture is the frames stacked, thirty two pixels wide and `32·count` tall, and the reference's own metadata
reader reports the stored header's measurements while the bitmap it decodes is the strip: the port reports the
header's in the entry and archive metadata and hands back the strip, as the reference does.

## Failing

The frame count is read out of a plane that may be shorter than four bytes and the frames may ask for more of the
planes than they hold; both are the reference's own array overruns and the port answers them with
`INVALID_ARCHIVE`. An animation of no frames at all is one that the framework the reference hands it to would
refuse, which the port reports as `UNSUPPORTED_FEATURE`, and a strip larger than the port will hold is refused
with `LIMIT_EXCEEDED`.

The tests cover the extension that finds the animations and the extensions that do not, a frame table read out of
the planes with the group just behind it left out of the picture, a strip of two frames, a frame table that
reaches past the planes, an animation of no frames, and a stream that ends in the middle of a group and one that
ends between two opcodes.
