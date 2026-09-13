# System98 G image

Reference: `GARbro/Legacy/System98/ImageG.cs`, class `GFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/system98/g-image.ts` (`system98GImageDescriptor`,
`system98GImageFormat`, id `system98-g-image`). The pixels are decoded by
`packages/formats/src/system98/gra-reader.ts`, a port of the `GraBaseReader` class that lives in the same
reference file and is shared by five formats in this repository.

| field | offset |
|---|---|
| width (`u16`, big endian) | 6 |
| height (`u16`, big endian) | 8 |
| sixteen RGB triples | 0xA |
| bit packed stream | 0x3A |

`ReadMetaData` rejects files shorter than **61 bytes** — header, colours and three stream bytes — and then
requires a non-zero width divisible by eight, a non-zero height, and dimensions within the PC-98 screen
bounds of 640 by 400. Because that minimum already covers the palette, the missing-colours case cannot arise
for this format; the sibling formats that read a palette at offset four have no such gate, which is why the
shared pattern keeps the check.

The port exposes the resource as a single entry:

* the pixels come from the shared bit-packed decoder, which resolves two pixels at a time through an
  adaptive 256 byte frame and writes packed four bit rows. Its own unit tests cover the frame layout, the
  three control bit cases, the end-of-stream flush and the overlapping block copies; this format's tests
  cover the end-to-end path, including the exact bytes a zero stream produces and a truncated stream that
  decodes to a partial image;
* the output is a **four bit palette bitmap**, written by the new `writeBmp4` helper in `shared/bmp.ts`. The
  stored rows are already packed two pixels per byte, so the only change is the bitmap's four byte row
  alignment. The palette is read as RGB triples and written as BGRX entries, which a test checks channel by
  channel with a palette whose three channels all differ. This keeps the source depth rather than widening
  it, as the FRM and MBP ports do for their depths;
* `Read` uses `ImageData.Create`, so rows stay top down and the bitmap is written with a **negative** height;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file, and keeps
  `sizeKnown: false` because a bitmap header is written around the pixels;
* entry metadata carries `type: "image"`, width, height and `bitsPerPixel: 4`; the archive metadata records
  `image: "bmp"`, the dimensions, the bit depth and `colors: 16`.

Declines, all tested: a file shorter than the minimum, a zero width or height, a width that is not a
multiple of eight, and dimensions past the screen bounds (both of the last pair are multiples of eight, so
the bounds are what reject them). The reference declares no signature, so the descriptor registers none and
the format is a candidate for every file; the extension list holds `g`, the one named extension the
reference declares alongside an unnamed one.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope.
