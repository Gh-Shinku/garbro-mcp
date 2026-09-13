# YellowCap GGF image

Reference: `GARbro/Legacy/YellowCap/ImageGGF.cs`, class `GgfFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/yellowcap/ggf-image.ts` (`ggfImageDescriptor`, `ggfImageFormat`,
id `yellowcap-ggf-image`).

The sibling of GEF and the same shape of container, but holding a **bare BMP behind eight bytes that
repeat its dimensions** rather than a PNG. The reference declares no signature and reads ten bytes, of
which only the last two matter:

| field | offset |
|---|---|
| width (u32) | 0 |
| height (u32) | 4 |
| embedded bitmap, `BM` signature included | 8 |

The eight own bytes are the whole header; the embedded stream starts at 8 and runs to the end of the file.

The one subtlety is the height comparison. A BMP stores its height signed, and a **negative** value means
the rows run top down, which GARbro's metadata reader normalizes to an absolute value. The reference
therefore compares `info.Height` with the header's `u32` — that is, `|biHeight|` — so a top-down GGF
legitimately records a positive height in its eight byte header. The port compares the same way, and a test
covers a bitmap whose `biHeight` is `-3` while the header says `3`.

The port exposes the resource as a single entry:

* detection requires an embedded `BM` marker, a DIB header of at least forty bytes (an OS/2 core header is
  declined), non-zero dimensions, a plausible `bfSize`, and — as the reference does — that the bitmap's own
  width and height agree with the eight byte header's copies. Both mismatches are tested separately;
* the smallest accepted file is 62 bytes, the eight byte header plus the fifty four byte bitmap header the
  metadata reader consumes;
* the entry is named after the source file with a `bmp` extension, covers everything from offset 8 to the
  end of the file and sets `sizeKnown: true`: the embedded stream is the bitmap itself, so the listed size
  really is the extracted size. Extraction is a straight copy — trailing bytes beyond `bfSize` travel with
  it, which a test pins deliberately, since the container stores no length that would justify trimming;
* entry metadata carries `type: "image"` with the dimensions and bits per pixel, and the archive metadata
  records `image: "bmp"` with the same values.

One defensive deviation is worth naming: a `bfSize` outside the file is declined here, where the reference
would go on to read the pixels according to the dimensions. No file that decodes in GARbro is affected.

Encoding and archive creation are out of scope.
