# Logg FRM image

Reference: `GARbro/Legacy/Logg/ImageFRM.cs`, class `FrmFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/logg/frm-image.ts` (`frmImageDescriptor`, `frmImageFormat`, id
`logg-frm-image`).

A **palettised eight bit image with an explicit row stride**. The signature word is `0x4D5246`, that is
`FRM` followed by a zero byte, and the header is sixteen bytes:

| field | offset |
|---|---|
| signature `FRM\0` | 0 |
| width (`u32`) | 4 |
| height (`u32`) | 8 |
| stride (`i32`) | 0xC |
| palette, 256 RGBA quads | 0x10 |
| pixels, `stride * height` bytes | 0x410 |

The port exposes the resource as a single entry:

* `ReadMetaData` reads the header and nothing else — it does not even check the file length — while `Read`
  seeks to `0xC`, takes the stride, reads the palette and then consumes `stride * height` pixel bytes.
  The port keeps that split: detection and listing need only the header, and a file whose pixel data runs
  past its end is still listed and only fails when it is extracted. That case is tested;
* the deviations in `detect` are a zero width or height, a negative stride and a stride narrower than the
  image. None can describe the pixel data the reader then consumes, and the reference would produce a
  malformed image or read past its buffer. A file that has a header but not yet the palette is declined
  too;
* extraction writes a bitmap through the new shared `writeBmp8Palette` helper: a 54 byte header, the
  **palette copied verbatim** zero padded to 256 entries, and the pixels. Because the port knows the
  source stride while the bitmap has to use its own, rows are compacted — the first `width` bytes of each
  stored row become one bitmap row and the padding is dropped. A test stores `0xEE` in every padding byte
  and then asserts that value appears nowhere in the output, so a port that copied rows wholesale would
  fail it;
* the bitmap is top down, matching `ImageData.Create`, so its height is negative. The palette is *not* a
  grey ramp: the test palette is a distinct pattern, and the assertion compares the first quads with what
  the file stored;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file and sets
  `sizeKnown: false` because a bitmap header and palette are written around the pixels;
* entry metadata carries `type: "image"`, width, height and `bitsPerPixel: 8`; the archive metadata
  records `image: "bmp"`, the dimensions and the source stride.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope.
