# BeF ALP bitmap mask

Reference: `GARbro/Legacy/hmp/ImageALP.cs`, class `AlpFormat`, tag `ALP/BeF`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/bef/alp-image.ts` (`befAlpImageDescriptor`, `befAlpImageFormat`,
id `bef-alp-image`).

A **raw six bit grey mask with no header at all**. Everything about the format is constant except the
pixels: the reference gates on the `.alp` extension and an exact file length of `0x25800`, then reports
320×480 at 8 bits per pixel. That length is not arbitrary — it is exactly `320 * 480`, which the test
asserts so the two constants cannot drift apart.

On read the reference expands every sample with `pixels[i] = (byte)(pixels[i] * 0xFF / 0x40)`. Two
consequences are worth stating, because both are surprising and both are reproduced:

* the arithmetic is done in `int` and then cast to `byte`, so a sample **above** `0x40` **wraps** rather
  than saturating. An input of `0xFF` yields 248, not 255;
* consequently only an input of exactly `0x40` reaches full scale. `0x3F` — the largest value the mask is
  meant to hold — maps to 251. Code that assumed the 6 bit maximum maps to 8 bit maximum would be wrong.

The port exposes the resource as a single entry:

* detection requires the `.alp` name (case insensitively) and the exact length. The name gate lives in
  `detect` and `read`, where the source path is available, while `openEntry` validates the length alone;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file and sets
  `sizeKnown: false` because a bitmap header and palette are prepended;
* extraction expands the samples and writes an 8 bit grey bitmap with `writeBmp8`. The reference uses
  `ImageData.Create`, so the rows run top down and the bitmap carries a negative height; the standard 256
  entry grey palette is written, and since 320 is a multiple of four no row padding is needed;
* entry metadata carries `type: "image"` with the dimensions and bits per pixel, and the archive metadata
  records `image: "bmp"` with the same values.

Note that GARbro has two further classes named `AlpFormat` — `ArcFormats/Masys/ImageALP.cs` and
`ArcFormats/GameSystem/ImageALP.cs` — which are different formats with their own tags and are not covered
by this port.

Encoding and archive creation are out of scope.
