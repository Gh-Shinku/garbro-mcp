# Seraphim CF image

Reference: `GARbro/ArcFormats/Seraphim/ImageSeraph.cs`, class `SeraphCfImage` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/seraphim/seraph-image.ts` (`seraphimCfImageDescriptor`,
`seraphimCfImageFormat`, id `seraphim-cf-image`). Three more pictures of the same file and the same header are
ported beside it: `seraphim-ct-image`, `seraphim-cb-image` and `seraphim-cx-image`.

| offset | field |
|---|---|
| 0 | `CF` |
| 2 | a version byte, which the reference never reads |
| 3 | nought |
| 4 | the offset of the picture, signed |
| 6 | its offset down, signed |
| 8 | width, sixteen bits |
| 10 | height, sixteen bits |
| 12 | the length of the compressed stream behind the header |
| 16 | the stream |

The reference registers six words of its own — the letters `CF` with a version of nought, two, four, seven, nine
or twenty — and then a **zero**, which is the pass that offers every remaining file to the format. The port
registers the six and keeps the trailing zero as its extension fallback, so a file whose version byte is none of
those is still read when its header is otherwise sound. The header itself is the real gate: the two letters, the
zero at the third byte and a stream that fits.

The picture is three bytes to the pixel and its rows run **from the bottom up**; the reference flips them and
hands the result to `ImageData.Create`, so the port writes a bitmap with a **negative height** at the same place.

## The compressed stream

Every opcode is one control byte and, for most of them, one or two bytes behind it. A control byte whose high
nibble is fifteen is not an opcode at all: the reference throws `InvalidFormatException` and the port raises
`INVALID_ARCHIVE` with the same place in mind.

| control | meaning |
|---|---|
| `00`–`3F` | a literal run of `(c & 3F) + 1` bytes |
| `40`–`7F` | one byte repeated `(c & 3F) + 2` times |
| `80`–`8F` | one byte repeated `(low \| ((c & F) << 8)) + 2` times |
| `90`–`9F` | a copy of `(low \| ((c & F) << 8)) + 1` bytes from one row above |
| `A0`–`AF` | the same from two rows above |
| `B0`–`BF` | the same from four rows above |
| `C0`–`C7` | three bytes read as they stand and repeated, a whole number of pixels at a time |
| `C8`–`CF` | the same with six bytes |
| `D0`–`DF` | a copy from `three bytes × (low \| ((c & F) << 8) + 1)` back, counted in pixels |
| `E0`–`EF` | a copy from `(low \| ((c & F) << 8)) + 1` bytes back |

A copy that reaches in front of the picture is the failure of the reference's own block copy; the port stops
with `INVALID_ARCHIVE`. A stream that simply ends is **not** an error: the reference stops decoding, leaves the
rest of the picture as the zeroes it allocated, and the port does the same.

The tests cover the six words and the version byte the format is still reachable with, a header of the wrong
letters or a wrong fourth byte, a stream that is absent or longer than the file, measurements of nought, a
picture read bottom up into a top down bitmap, a row copied from the row above with its truncated count, a short
fill and a repeated pattern, a stream that ends early, an opcode the reference does not know, and a run that
reaches in front of the picture.
