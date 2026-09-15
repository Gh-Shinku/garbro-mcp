# Windows bitmap

Reference: `GARbro/GameRes/ImageBMP.cs`, classes `BmpFormat` and `BmpMetaData` (Windows device independent
bitmap). GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/gameres/bmp-image.ts` (`gameresBmpImageDescriptor`,
`gameresBmpImageFormat`, id `gameres-bmp-image`). This is GARbro's own reader for the format rather than one of
the engines that hide a bitmap behind a header of their own; a port that finds a bitmap inside another file uses
the shared reader in `packages/formats/src/shared/bmp.ts`, which this format shares.

The reference registers no signature of its own, which offers the format every file it is tried on, and a single
byte pair decides: `BM`. The port keeps that shape, with the rest of the header read inside the reader.

| offset | field |
|---|---|
| 0 | `BM` |
| 2 | the length the bitmap claims, which the reference is lenient about |
| 10 | where the pixels begin |
| 14 | the length of the header that follows |
| 18 | the width, a word in the older header and a double word in every other |
| 20 or 22 | the height, likewise, stored negative when the rows are the other way up |
| 22 or 26 | the number of colour planes, which has to be one |
| 24 or 28 | the bits to a pixel |

A bitmap that claims **no** length, or the fourteen bytes of its own file header, is read as far as it goes, and
one that claims more than the file holds is clamped to the file. A header of twelve bytes is the older one: its
measurements are words, it stores **three** bytes to a colour, its rows are always bottom up, and it has no
compression field at all. Every other header has to be at least forty bytes long and fit inside the length the
bitmap claims.

The colours of a palette are stored blue, green, red, with the fourth byte of a full entry reserved, and the
number of them is however many the depth allows unless the header names one.

## What comes out

The picture is written again at the depth it was stored in, so an eight bit bitmap keeps its colour map, a
sixteen bit one keeps its colour masks and a palette bitmap keeps its indices. Two things the reference does are
left out:

* the readers it tries before its own decoder, which lay an **appended alpha plane** over the picture, are behind
  a setting that is off unless a user turns it on, so the port leaves them alone;
* a **run length** bitmap is refused with `INVALID_ARCHIVE` where the framework the reference hands it to would
  decode it, since the shared reader here knows only the two uncompressed layouts.

The height a bitmap with top-down rows declares is stored negative. The reference reads that word as unsigned and
reports a measurement in the billions; the port reports the height of the picture it hands back, which is the
same measurement with its sign taken off.

The reference can also **write** bitmaps, which this project does not do: it only takes them apart.

The tests cover the tag that finds a bitmap and the buffers that are not one, the measurements a header declares,
every depth the reader can weave including the two the older header stores, the two lengths a bitmap may leave
out and the length that is clamped, a header too short to be one and a bitmap whose pixels are not there at all,
and a depth the reader does not know.
