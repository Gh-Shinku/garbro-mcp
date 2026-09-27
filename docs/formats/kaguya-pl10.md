# KaGuYa PL10 animation resource

## Reference and attribution

- GARBro reference: `ArcFormats/Kaguya/ArcPLT.cs` (`Pl10Opener`, `Pl10Entry`) with the entry handling of
  `An21Opener` in `ArcFormats/Kaguya/ArcAN21.cs`
- GARbro tag: `PL10`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The signature spells `PL10`, the frame count sits at 4, and the first frame's information block at 0x16 holds
its offsets, width, height and a depth word that the reference multiplies by eight to get the bits per pixel.
The first frame is stored raw behind that 0x14-byte block. Every later frame carries a step byte and a packed
size in front of RLE-compressed pixels whose output length is that same image size, so the frame is
`frame_index`, the step, the spans and the image size are recorded as metadata, and frames are named
`<archive>#<index padded to 2>` from the frame index.

The reference reads the step byte without validating it, yet its unpacker cannot work with a zero step, so the
port rejects such a frame — the same kind of hardening it applies to the derived spans, which the reference
also leaves unchecked.

## Packed frames

`An21Opener.OpenEntry` expands a packed frame with `DecompressRLE`, which fills the output on a stride of
`rle_step` bytes: each of the first `rle_step` positions takes one literal, and every later position takes a
byte and then, when that byte repeats the previous one, a run length. A run length whose high bit is set
continues in the next byte, with the low seven bits as its high part plus an extra 128, so an extended run
always claims at least 128 positions and simply stops at the end of the output. After any run one more literal
is read when space remains, which seeds the next comparison. The reference reads without checking bounds, while
the port stops at either end.

`Pl10Opener` stands of `An21Opener` for every frame but the first, so the picture of a frame of this format stands of
the places of the frames before it exactly as a frame of the sibling `AN21` format does: the places of every frame of
the walk stand over the places of the frame before it, one place of a colour at a time, of the whole of the places of a
colour to a place. The reference walks back from the frame it stands of through the frames before it; this port walks
forward from the first frame, which stands of the same counts without a walk of the depth of the count. The places then
stand handed over as a bitmap of one, three or four places of a colour — one stands of a picture of grey — and the rows
of the picture stand of the file turned over, since the inherited `BitmapDecoder` stands of `ImageData.CreateFlipped`.

## Support

| Capability | Status |
| --- | --- |
| `PL10` signature detection | Supported |
| Frame count validation | Supported |
| First frame raw behind its information block | Supported |
| Later frames with a step byte and packed size | Supported |
| Interleaved RLE with simple and extended runs | Supported |
| Frame naming by index | Supported |
| Frame metadata (depth, size, step, spans) | Supported |
| Zero step and span bound rejection | Supported as a hardening |
| Frame accumulation: the places of the frames before a frame over the places of it | Supported |
| Bitmap decoding of a frame: one, three or four places of a colour to a pixel, rows turned over | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a raw first frame, a packed frame with a simple run, one with an extended run, a zero
step, and a packed size that leaves the file.
