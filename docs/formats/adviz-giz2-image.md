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

picture stand walked. The picture is walked in **strips of eight places**: for every strip, the records of the

(the words of the head name it):

- **a place of its own**, standing as the word behind the walk stands;
- **a run of places of one value**, of a value of nothing, of the whole of a place, or of the word behind it,
- **a run of places of two values that stand beside each other**, the second of the two standing as the first
  standing behind the two where the words name six;
  the walk names seven or more.

places of a record of them.

## The palette, which stands beside the game rather than within the picture

the words the picture is named with and two and fifty for the words of the walk of it. The palette of such a
picture stands in the table of palettes of the engine beside the game, as the palette of a `BIZ` picture of the

## Deviations from the reference

  the order of the words of a picture instead, so the two stand apart.
- The reference throws where the palette stands absent; this port refuses the picture with a `GarbroError`
  naming the palette.
- A picture of no places, and a picture whose places do not stand in strips of eight, are refused; the
  reference would walk them as they stand.
  file.

## Tests

`tests/formats/adviz-giz2-image.test.ts` covers the head of a picture, where a picture stands within a picture
a picture of four places (covering a place of its own, a run of places of one value, a record that stands
stands in, a picture that stands with no palette beside it, and the words the picture is told by.
