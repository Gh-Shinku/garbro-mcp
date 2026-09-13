# Ai5 RMT image

Reference: `GARbro/ArcFormats/elf/ImageRMT.cs`, class `RmtFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/elf/rmt-image.ts` (`rmtImageDescriptor`, `rmtImageFormat`, id
`ai5-rmt-image`).

An LZSS stream over a delta coded bitmap:

| field | offset |
|---|---|
| signature `RMT ` | 0 |
| position X (`i32`) | 4 |
| position Y (`i32`) | 8 |
| width (`u32`) | 0x0C |
| height (`u32`) | 0x10 |
| LZSS stream | 0x14 |

`ReadMetaData` reads twenty bytes, takes the two position words and the dimensions, and fixes the depth at
thirty two; nothing else in the header is read. The port carries the positions into both the entry and the
archive metadata, since they are the only interesting thing the reference keeps from them.

## The delta

The decompressed pixels are differences: every pixel holds what to add to the one before it, and every row what
to add to the row above. The reference adds, in place, the pixel four bytes earlier for the **first row only**,
then the pixel a stride earlier for every other row, both a byte at a time and both wrapping at a byte the way
adding to a `byte` does in C#. The port's two loops are the byte-wise equivalent of the reference's four byte
steps, which a comment says outright.

The test derives its expectations by hand rather than by re-running the port's loops: deltas of
`1 2 3 4 | 5 6 7 8 | 9 10 11 12 | 13 14 15 16` in a two by two image become
`1 2 3 4 | 6 8 10 12 | 10 12 14 16 | 19 22 25 28`, with the within-row step visible in the first row and the
cross-row step in the second. A second test wraps a sum at a byte (`0xF0` then `0x20` gives `0x10`, not `0x110`).
`ImageData.CreateFlipped` stores rows bottom up, which a bitmap records with a **positive** height, and the test
checks the sign — the one place this port differs from nearly every other image reader here.

## Two things the shared codec taught

* **`inflateLzss(input, { outputLength })` is the variant this format needs**, not `inflateLzssAll`. The
  reference reads through an `LzssStream` into a buffer of exactly the pixel count, so it stops there, ignores
  anything after the last pixel, and leaves the rest of the buffer alone: a stream that runs out gives zeros for
  the remaining pixels. `inflateLzssAll` with `maxOutputLength` instead **throws** when a token would pass the
  limit, which is not what the reference does. Note also that `inflateLzss` returns only the bytes it decoded,
  so the port places them into a zero filled buffer of the pixel count — the reference's buffer is one its caller
  allocated and zeroed.
* **LZSS control bits are taken from the low end.** This port's fixtures are the first here that depend on the
  order rather than using `0xFF` for a run of literals, and the first attempt used `0x07` for "literal, literal,
  match"; the third bit set means a **literal**, so the match bytes were emitted verbatim. The control byte for
  literal, literal, match is `0x03`.

## Notes

* The match test uses the standard token layout the shared codec documents: `EE F0` names frame offset `0xFEE`
  (where the first literal landed, given the default initial write position) with a length of three, and the
  output stops at the fourth byte of a one pixel image.
* Trailing junk after a complete image is never read, which a test shows by appending a second token sequence.
* The entry is named after the source file with a `bmp` extension, covers the whole stored file and keeps
  `sizeKnown: false`; it is marked `compressed`. A short header, a wrong signature and zero dimensions are
  declined, the last as a documented deviation, and the reference declares no extensions.
* `Write` throws `NotImplementedException` in the reference, so encoding is out of scope.
