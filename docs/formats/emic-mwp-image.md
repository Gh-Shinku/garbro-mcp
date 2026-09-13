# Emic MWP bitmap

Reference: `GARbro/ArcFormats/Emic/ImageMWP.cs`, class `MwpFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/emic/mwp-image.ts` (`mwpImageDescriptor`, `mwpImageFormat`, id
`emic-mwp-image`).

A raw 32 bit image with a twelve byte header and no container around it:

| field | offset |
|---|---|
| signature `MWP\x10` or `TEYL` | 0 |
| width (`u32`) | 4 |
| height (`u32`) | 8 |
| BGRA pixels, top down | 0xC |

Two things set it apart from the other raw-image ports. The first is that the reference registers **two**
signature words, `0x1050574D` (`MWP\x10`) and `0x4C594554` (`TEYL`), so the same body ships under two
headers; the descriptor lists both and a test covers the variant. The second is that `ReadMetaData` seeks
straight to offset four and reads the dimensions **without validating anything at all** — no dimensions
check, no pixel count, not even a second look at the signature. The port therefore derives the layout from
the header alone and lets extraction carry the pixel count, which keeps the reference's failure timing: a
file whose pixels are missing is still listed and only fails when it is extracted. That split is tested
directly.

The port exposes the resource as a single entry:

* extraction reads `width * height * 4` bytes and writes them into a 32 bit bitmap. `ImageData.Create` with
  `Bgra32` stores rows top down and keeps the byte order, so the bitmap has a negative height and the pixels
  are copied rather than reordered — both asserted;
* the reference fills a buffer of exactly that size and throws when the file is shorter, so a short pixel
  block is rejected at extraction rather than being padded or clamped;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file, and sets
  `sizeKnown: false` because a bitmap header is written around the pixels;
* entry metadata carries `type: "image"`, width, height and `bitsPerPixel: 32`; the archive metadata records
  `image: "bmp"` and the dimensions.

One deviation: a zero width or height is declined. The reference would accept the header and create an empty
image, which cannot describe anything stored. GARbro's `Write` throws `NotImplementedException`, so encoding
and archive creation are out of scope. The descriptor advertises `mwp` and `bmp`, matching the reference's
own extension list.
