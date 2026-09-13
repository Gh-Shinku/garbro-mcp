# LiLiM / Le.Chocolat ABM (multi-frame bitmap)

Reference: `GARbro/ArcFormats/Lilim/ArcABM.cs`, class `AbmOpener`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/lilim/abm.ts` (`abmDescriptor`, `abmFormat`, id `lilim-abm`).

The reference implements this as an image format with a frame listing: `TryOpen` builds one entry per
frame and `AbmReader` decodes a frame into a bitmap. The listing is ported; the decoder is out of
scope, so an extracted frame is the stored (still encoded) frame data and `sizeKnown` stays true.

## Header

| Offset | Size | Meaning |
|--------|------|---------|
| `0x00` | 2 | `BM` |
| `0x12` | 4 | width (`u32`) |
| `0x16` | 4 | height (`u32`) |
| `0x1C` | 1 | mode (`i8`, 1 = grayscale/3 byte pixel, 2 = 4 byte pixel) |
| `0x3A` | 2 | frame count (`i16`) |
| `0x42` | 4 | offset of the first frame |
| `0x46` | 4 × (count − 1) | offset of every later frame |

The file name of the first byte pair is `BM`, the mode must be 1 or 2, and the count must pass
`IsSaneCount`; anything else declines the file. Frames are named after the archive:
`<file name without extension>#<index:04>`, so `game.abm` yields `game#0000`, `game#0001`, ….

## Frames

`next_offset` starts at the word at `0x42`; for every frame but the last the following word comes
from the chain at `0x46 + 4i`, and the last frame ends at the end of the file. A chain word that does
not advance past the current frame declines the file, and every frame passes `checkPlacement`.

Each frame is reported with `unpackedSize = 0x12 + width * height * pixelSize`, where `pixelSize` is
3 for mode 1 and 4 for mode 2; the multiplication wraps in 32 bits exactly like the reference. The
archive metadata carries the image description the reference keeps in `AbmImageData`: `width`,
`height`, `bpp` (`pixelSize * 8`), `mode` and `baseOffset` (the offset of the first frame); every
entry carries `type: "image"`, its `unpackedSize` and its `frameIndex`.

`compressed` is reported as `false`: the reference's `OpenEntry` is verbatim and the frame layout is
interpreted by `AbmReader`, which is not ported.

## Deviations

* The `AbmReader` image decoder (frame header, mode dependent scanlines, optional compression) is out
  of scope, so frames are extracted as stored.
* The offset chain is read as one block; a file whose declared frame count needs more chain words
  than the file holds is declined instead of reading zeros past the end.
