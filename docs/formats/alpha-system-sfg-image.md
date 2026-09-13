# Alpha System SFG image

Reference: `GARbro/Legacy/AlphaSystem/ImageSFG.cs`, class `SfgFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/alpha-system/sfg-image.ts` (`sfgImageDescriptor`, `sfgImageFormat`, id
`alpha-system-sfg-image`).

| field | offset |
|---|---|
| plane count (`u16`) | 0 |
| width (`u16`) | 2 |
| height (`u16`) | 4 |
| palette, 256 four byte entries, one plane only | 8 |
| pixels | 0x408 one plane, 8 four planes |

## No signature and no extension: the length is the identity

`Signature` is zero and no extension is declared, so the format is identified entirely by eight bytes and one
comparison. The plane count must be **one or four** — a count of planes, not of bits — both dimensions must be
non-zero, and then a length has to match the file **exactly**: the pixels, plus the header, plus a kilobyte of
palette when there is one. Anything appended or missing is a decline, which tests check for both depths.

That equality is also what makes the reads safe. It is tempting to carry over the "a short stream is tolerated"
behaviour that several formats here have, but it **cannot be reached** in this one: if the length matches, the
palette and the pixel block are exactly as long as the file says, so every read is complete. The port notes that
where a reader would expect the tolerance, and a test says the same thing from the other side.

The reference computes the expected length in a **thirty two bit integer**, so a large pair of dimensions wraps.
A wrapped value is nearly always negative and so never equals a real file's length; a wrapped value that happens
to be positive and to match would be accepted and then read. The port follows that rather than adding a
dimension limit of its own, since a fabricated limit would decline files the reference accepts.

## Two depths, one palette

One plane is eight bit indexed and carries a palette of two hundred and fifty six four byte entries; four planes
is thirty two bit with no palette at all. The palette is read as `PaletteFormat.BgrA`, which is **already** the
blue-green-red-alpha order a bitmap wants, so unlike several other formats here it needs **no swap** and the four
bytes are carried across unchanged. A test pins the first two entries.

Both branches hand `ImageData.Create` a **tight** stride — one or four bytes a pixel — and the extracted bitmap
is **top down**, which a bitmap records as a negative height. Four bytes a pixel need no padding at any width, so
that branch's pixels are copied verbatim; the one plane branch's rows are padded out to four bytes, so a three
pixel row arrives as four.

## Notes

* The depth in the metadata is the plane count times eight: eight or thirty two.
* Because the extraction gains a header, `sizeKnown` is false.
* `Write` throws `NotImplementedException` in the reference, so encoding is out of scope.
