# Seraphim CB image

Reference: `GARbro/ArcFormats/Seraphim/ImageSeraph.cs`, class `SeraphCbImage` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/seraphim/seraph-image.ts` (`seraphimCbImageDescriptor`,
`seraphimCbImageFormat`, id `seraphim-cb-image`).

The only picture of this engine with a colour map:

| offset | field |
|---|---|
| 0 | `CB` |
| 2 | how many colours the map holds |
| 4 | the offset of the picture, signed |
| 6 | its offset down, signed |
| 8 | width, signed |
| 10 | height, signed |
| 12 | the length of the compressed stream |
| 16 | the colour map, three bytes to a colour, then the stream |

The reference registers one word of its own — `CB`, a nought and a one, the usual colour count of these files —
and the same trailing **zero** as the other pictures of the engine, which is why the port keeps its format
reachable for a file whose header is sound but whose fourth byte is not that one.

Three details of the header are worth naming:

* the measurements are **signed**, and one of nought or less is refused;
* the colour count may be nought, in which case no colour map is read at all and the picture is written with a
  map of black;
* the upper bound the reference places on the length of the stream is **commented out** in it, so only a nought
  is refused; the port keeps that, and a stream shorter than the header claims is tolerated by the decoder
  itself.

The colour map is read as red, green and blue, one byte each, and the port stores it the way a bitmap wants it:
blue, green, red and an unused byte, with the colours the header does not count left black.

## The compressed stream

The picture is one byte to the pixel and its rows run **from the bottom up**; the reference flips them and the
port writes a bitmap with a negative height. The stream is decoded by the byte reader the transparency plane of
`CT` also uses:

| control | meaning |
|---|---|
| `00`–`3F` | a literal run of `(c & 3F) + 1` bytes |
| `40`–`7F` | one byte repeated `(c & 3F) + 2` times |
| `80`–`8F` | one byte repeated `(low \| ((c & F) << 8)) + 2` times |
| `90`–`9F` | a copy of `(low \| ((c & F) << 8)) + 1` bytes from one row above |
| `A0`–`AF` | the same from two rows above |
| `B0`–`BF` | the same from four rows above |
| `C0`–`C7` | two bytes read as they stand and repeated |
| `C8`–`CF` | four such bytes |
| `D0`–`D7` | eight such bytes |
| `D8`–`DF` | sixteen such bytes |
| `E0`–`EF` | a copy of `low + 1` bytes from `(low \| ((c & F) << 8)) + 1` bytes back |

The row a copy reaches back to is counted in **bytes**, one row being the width of the picture. A control byte
whose high nibble is fifteen is not an opcode: the reference throws and the port raises `INVALID_ARCHIVE`. A
stream that ends early is not an error — the picture keeps the zeroes the reference allocated for it, and the
decoder writes a row of slack behind the picture rather than failing when a run overruns it, which the port
copies as well.

The tests cover the word the format is registered under and the colour count its reader also takes, a header of
more colours than the reference reads, measurements of nought or less, a stream of nought, the letters of the
other pictures, the colour map in the order a bitmap wants and its unused entries, a picture read bottom up into
a top down bitmap, a row copy with a truncated count, a repeated pattern, a copy of single bytes, a stream that
ends early, an opcode the reference does not know, and a picture of no colours.
