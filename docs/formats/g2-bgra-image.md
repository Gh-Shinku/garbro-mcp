# G2 BGRA image

Reference: `GARbro/ArcFormats/G2/ImageBGRA.cs`, class `BgraFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/g2/bgra-image.ts` (`bgraImageDescriptor`, `bgraImageFormat`, id
`g2-bgra-image`).

A **raw 32 bit BGRA image**:

| field | offset |
|---|---|
| `BGRA` | 0 |
| marker `0x08080808` | 4 |
| width (`u32`) | 8 |
| height (`u32`) | 0xC |
| BGRA pixels | 0x10 |

The marker is an exact word rather than a mask — `ReadMetaData` compares it for equality, so a value with a
single bit changed is declined, which is what a test does. The reference declares the extensions `argb` and
`arg`, neither of which is the four letter tag, and both are registered here.

The port exposes the resource as a single entry:

* `Read` insists on a full `width * height * 4` pixel buffer and throws `EndOfStreamException` when the file
  cannot supply it, while `ReadMetaData` never looks at the file length at all. That split is preserved:
  a file with short pixel data still **lists**, and extraction is what fails. A test asserts both halves, so
  a future change that starts validating the length during detection would be caught;
* data past the pixel buffer is ignored rather than copied, which a second test checks by appending slack;
* `Read` uses `ImageData.Create`, so rows stay **top down** and the bitmap is written with a **negative**
  height by the shared `writeBmp32` helper — the same shape as the Emic MWP and TEXB ports, and the opposite
  of the MSK and GR1 ports, which use `CreateFlipped`;
* the entry is named after the source file with a `bmp` extension and covers the whole stored file, with
  `sizeKnown: false` because a bitmap header is written around the copied pixels;
* entry metadata carries `type: "image"`, width, height and bit depth; the archive metadata records
  `image: "bmp"` and the dimensions.

Declines, all tested: a marker that is off by one bit, a zero width or height (the reference would accept an
empty image) and a file that stops inside the header.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope.
