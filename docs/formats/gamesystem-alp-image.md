# 'Game System' ALP grayscale image

Reference: `GARbro/ArcFormats/GameSystem/ImageALP.cs`, class `AlpFormat`, tag `ALP/GAMESYSTEM`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/gamesystem/alp-image.ts` (`gamesystemAlpImageDescriptor`,
`gamesystemAlpImageFormat`, id `gamesystem-alp-image`).

An **eight byte header followed by one byte per pixel**, with no brand marker other than the `.alp`
extension. The reference declares no signature; what identifies the format is the name plus an exact
length relation.

| field | offset |
|---|---|
| width (u32) | 0 |
| height (u32) | 4 |
| grayscale pixels | 8 |

Acceptance requires the `.alp` extension, non-zero dimensions and a file length of exactly
`8 + width * height`. The port computes that relation with `BigInt`, so a hostile header cannot overflow
it, and tests check both directions — one byte longer and one byte shorter than declared are both
declined.

The port exposes the resource as a single entry:

* detection applies the name gate and the length relation. The name check lives in `detect` and `read`,
  where the source path is available, while `openEntry` validates the length alone;
* the entry is named after the source file with a `bmp` extension, covers exactly the pixel bytes and sets
  `sizeKnown: false` because a bitmap header and palette are prepended;
* extraction writes an eight bit grey bitmap with `writeBmp8`. The reference reads through
  `ImageData.CreateFlipped`, so the rows run **bottom up** and the bitmap height stays **positive** — the
  opposite of the BeF `ALP/BeF` port, which reads through `ImageData.Create` and gets a negative height.
  To express that, `writeBmp8` gained the optional `bottomUp` flag that `writeBmp32` already had; the flag
  defaults to false, so the existing callers in the TBL, WMK and BeF ports are unaffected, and their test
  suites were re-run with this change;
* since `width` need not be a multiple of four, the writer pads every row to the next four byte boundary,
  which a three pixel wide fixture exercises;
* entry metadata carries `type: "image"` with the dimensions and bits per pixel, and the archive metadata
  records `image: "bmp"` with the same values.

Note that GARbro has three classes named `AlpFormat`; the Masys `ALP/MEGU` one is a different, compressed
format and is not covered here.

Encoding and archive creation are out of scope.
