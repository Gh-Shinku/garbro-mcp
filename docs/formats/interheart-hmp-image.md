# Interheart hover map

Reference: `GARbro/ArcFormats/Interheart/ImageHMP.cs`, class `HmpFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/interheart/hmp-image.ts` (`interheartHmpImageDescriptor`,
`interheartHmpImageFormat`, id `interheart-hmp-image`).

An **eight bit puzzle map with no marker at all**: the reference registers `Signature = 0` and its
`ReadMetaData` returns nothing unless the file name ends in `.hmp`, so the extension is the whole of the
detection. The dimensions are two words at the front — the width at `0` and the height at `4`, each non zero and
below `0x7FFF` — and the pixels then run from offset eight for exactly `width * height` bytes, with neither a
stride nor any compression.

The palette is the reference's own `DefaultPalette`, and two of its details are worth recording because they are
easy to "fix" by accident:

* the grey ramp is written for **every** index from eight upwards first, and the sixteen bright colours are then
  written **over** the front of it, so the ramp only really starts at index **nineteen**, not at eight;
* index sixteen is assigned **twice** — `0xFF7F00` and then `0xFF7F7F` — so the second value is the one that
  stands, which a test pins down.

Both are reproduced as they are, and the colours are converted from the reference's red-green-blue
`Color.FromRgb` order into the blue-first order a bitmap palette holds.

Also faithful:

* a body shorter than the image fails: the reference reads what it asks for and hands the short buffer to its
  image layer, and the port raises a `GarbroError` instead;
* there is no flip, so the bitmap is **top down** and its rows are tight;
* bytes behind the pixels are ignored, and the entry keeps `sizeKnown: false`.

The tests cover the extension gate, the dimension checks, the metadata, the pixels with their row padding, the
palette with both quirks, the short body and the entry name.
