# ADVIZ engine image format (GIZ2)

Reference: `GARbro/Legacy/Adviz/ImageGIZ2.cs`, classes `GizFormat` and `Giz2Reader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/adviz/giz2-image.ts` (`advizGiz2ImageDescriptor`,
`advizGiz2ImageFormat`, id `adviz-giz2-image`, `readGiz2Layout`, `readGiz2Palette`, `decodeGiz2Picture`) over
the walk in `packages/formats/src/adviz/giz2-reader.ts` (`GIZ2_HEADER_SIZE`, `unpackGiz2Picture`). The palette
of the engine stands in `packages/formats/src/adviz/palette.ts`, which the `BIZ` picture of the same engine
stands on as well. The engine's own archive stands in `packages/formats/src/adviz/biz2-image.ts` for the
kindred `BIZ2` picture.

## The picture

Sixteen places of a head name where the picture stands within a picture of the places of a picture of the game
(a place of a picture of eighty places along, and the places of a picture of eight places within it), how wide
and how tall the picture stands, the place of the walk of it, and which of four records of the places of the
picture stand walked. The picture is walked in **strips of eight places**: for every strip, the records of the
places of the picture stand walked one after another from the words behind the head, and the places of the
picture of the strip stand beside the places of the four records, the places of a record standing above the
places of the record behind them.

A place of the walk of the records names one of four kinds, told by the place of the walk of the picture itself
(the words of the head name it):

- **a place of its own**, standing as the word behind the walk stands;
- **a run of places of one value**, of a value of nothing, of the whole of a place, or of the word behind it,
  with the places of the run standing behind that;
- **a run of places of two values that stand beside each other**, the second of the two standing as the first
  turned about within its places by one or by two where the words name four or five, and the places of the run
  standing behind the two where the words name six;
- **a place of the walk of the picture itself**, standing as the word of the walk stands, where the place of
  the walk names seven or more.

Two quirks of the reference stand in this port: the four records of the places of a picture are walked once for
every strip of the picture, so a record that stands unwalked for a strip holds the places of the strip before
it; and the walk of a record counts the places it stands for against the places of the picture rather than
against the places of the record, so a run of places stands for the places of the picture rather than for the
places of a record of them.

## The palette, which stands beside the game rather than within the picture

Fifteen places of a head stand beside the words of the head of a picture of this kind, four of which stand for
the words the picture is named with and two and fifty for the words of the walk of it. The palette of such a
picture stands in the table of palettes of the engine beside the game, as the palette of a `BIZ` picture of the
same engine stands, and holds sixteen places of three places each: every place of a palette of this kind stands
as one of sixteen of the places of a picture.

## Deviations from the reference

- The reference reads the palette of a picture of this kind in the order of the words of a picture — the places
  behind a place of a palette stand for the places of the picture — and this port reads them in that order and
  stands them in a picture of the places of a picture of four places, which holds the places of a palette in
  the order of the places of a picture. The `BIZ` picture of the same engine holds the places of its palette in
  the order of the words of a picture instead, so the two stand apart.
- The reference throws where the palette stands absent; this port refuses the picture with a `GarbroError`
  naming the palette.
- A picture of no places, and a picture whose places do not stand in strips of eight, are refused; the
  reference would walk them as they stand.
- The reference walks a record of the places of the picture past the places of the record without a word; this
  port refuses a walk that stands past the places of a picture, the places of a record, or the places of the
  file.

## Tests

`tests/formats/adviz-giz2-image.test.ts` covers the head of a picture, where a picture stands within a picture
of the places of a picture, the heads it is turned away for, the walk of the places of a picture into places of
a picture of four places (covering a place of its own, a run of places of one value, a record that stands
unwalked, and a run of places of two values), the places of a picture stood out with the palette of the game it
stands in, a picture that stands with no palette beside it, and the words the picture is told by.
