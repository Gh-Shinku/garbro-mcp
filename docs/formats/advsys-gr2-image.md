# AdvSys engine image format

Reference: `GARbro/ArcFormats/AdvSys/ImageGR2.cs`, class `Gr2Format`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/advsys/gr2-image.ts` (`advsysGr2ImageDescriptor`,
`advsysGr2ImageFormat`, id `advsys-gr2-image`, `readGr2Layout`, `unpackGr2Picture`, `packGr2Rows`).

## The picture

The words `GR2_` stand in the first places of the file, and behind them stand how wide and how tall the
picture stands and how many places a place of it stands in, told as the places of a picture of a byte each and
standing in the words of the head of the picture of the engine. The reference stands the places of a picture of
eight places, of four and twenty and of two and thirty places, and stands a picture of a kind of its own away
with a word of its own.

The places of the picture stand as they stand behind the words of the head of it, no walk of the places of a
picture standing between them: the places of a row stand as many places as the places of a row stand for,
padded to the places of four. The reference hands the places of the picture out in the kind of the places of a
picture the words of the head name — `Bgra32`, `Bgr24` or `Bgr555` — with the places of a row standing in the
places of the picture of the kind of the places of a picture of a row stand in.

## Deviations from the reference

- The reference hands the places of a picture out with the places of a row standing padded, standing them in
  places of a picture of the kind of the places of a picture of its own; this port stands the places behind the
  places of a row away, since a picture of this project stands the places of a row with no places behind them,
  and a picture of a picture of a kind of its own stands the places of a row padded as it stands them.
- A picture that stands short of the places of a picture stands refused with a `GarbroError`; the reference
  stands such a picture away with a word of its own.
- A picture of no places stands nowhere and is refused, and a picture whose places would stand past a limit of
  this project's own stands refused as well.
- The reference reads the places of a picture of a kind of the places of a picture it stands no places for as a
  word of its own with no kind of the places of a picture; this port refuses such a picture as it refuses the
  words of the head.

## What stands unported of the same file

`PolaFormat` (the kind `GR2/Pola`) stands unported. A picture of that kind stands as a picture of this kind
walked rather than as the places of a picture stand: the walk of the places of it names a place of the picture
that stands behind the place written, with the count of the places of the walk of it standing as a walk of a
kind of its own (a place of the walk naming one of four and twenty or more places of the picture) and with the
places of the picture of two places standing in a kind of their own as well. The head of a picture of that kind
stands of the words `*Pola` and, of the kind of a picture of the second kind of its walk, of the words `*  `,
and the words of the head of a picture of the first kind of its walk stand as the places of a picture of the
kind of the places of a picture of this kind of a picture, so the two kinds stand apart in the words of the
head and in the places behind them.

## Tests

`tests/formats/advsys-gr2-image.test.ts` covers the head of a picture and the places of a row standing padded
to the places of four, the heads it is turned away for (of a kind of the places of a picture it stands no
places for and of no places), the places of a picture read as they stand (with the places behind the places of
a picture standing unread), a picture cut short of its places, a picture of two and thirty, one of four and
twenty (with the places behind the places of a row standing away) and one of sixteen places standing out, and
the words the picture is told by.
