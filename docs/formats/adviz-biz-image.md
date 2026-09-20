# ADVIZ engine image format

Reference: `GARbro/Legacy/Adviz/ImageBIZ.cs`, class `BizFormat` and its palette reader. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/adviz/biz-image.ts` (`advizBizImageDescriptor`,
`advizBizImageFormat`, id `adviz-biz-image`, `readBizLayout`, `unpackBizPicture`, `readBizPalette`,
`decodeBizPicture`) over the palette of the engine in `packages/formats/src/adviz/palette.ts`
(`readAdvizPalette`, `PALETTE_MAPPERS`), which is meant to serve `GIZ/2` as well.

## The picture

Four places of a head name how wide and how tall the picture stands, and the places of the picture stand behind
it, one place for every place of the picture: the reference refuses a picture whose places behind the head do
not stand for such a picture. The places of the picture stand walked with a place that changes as they are
walked — every stored place stands beside the place of the walk, and the place of the walk then stands for the
sum of itself and the place of the picture, within a byte. The reference hands the places of the picture out
from the last place of it rather than from the first, so the places of the picture stand from the foot of it
upwards.

## The palette, which stands beside the game rather than within the picture

A picture of this kind holds no palette of its own. It stands in two companions of the engine, one directory
above the picture: `GRP_TBL.SYS`, the words of the places of a picture of the game, and `PLT_TBL.SYS`, the
palettes of them. A record of `GRP_TBL.SYS` holds twelve places: eight places of words and four behind them.
The reference stands the words of the picture in that record to find the place of a palette, with three
quirks that this port keeps:

- the words of a picture of the places of a picture of a person stand as the words of the first place of the
  picture of that person, so that the place of the kind of the picture stands behind them (the words stand
  matched against the words of the picture as they stand, with the kind of the picture standing at the end);
- the reference stands the words of a picture that stand short of the words of a place of the words of the
  engine padded with **one** place, whatever the places they stand short of them, so that the words stand
  matched against the first places of a record only where they stand short;
- the place of a palette stands as the place of the record of the words multiplied by the places of a palette,
  and where that place stands beyond the palettes of the table of palettes the reference stands the place of
  the last palette of the table, the places of the table standing divided by the places of a palette and
  shortened by one.

The pair of the sizes of the two companions names a kind of the places of the palettes where the reference
names one: the table `PALETTE_MAPPERS` holds the kinds of the engine, one naming the place of a palette of a
picture by the words of the picture, over a hundred and fifty of them, and one naming the places of the
palettes of the engine shifted by two and fifty places. A picture stands with a place of its own where the
table names no kind. Where the reference stands the words of a picture beside the table it stands them for the
words of the picture rather than for the filled words, so the kinds that name the places of a palette by the
words of a picture stand on the words of the picture itself.

## Deviations from the reference

- The reference reads the palette of a picture of this kind in the order of the places of a picture
  (`PaletteFormat.Rgb`, so a place of the palette stands as the places of the picture, of the picture behind
  them, and of the places behind both); this port reads them in that order and stands them beside the places of
  a picture of its own.
- The reference throws where the two companions of the engine stand absent or where no record of
  `GRP_TBL.SYS` names the picture; this port refuses the picture with a `GarbroError` naming the palette.
- A picture of no places stands nowhere and is refused, and a picture whose places would stand past a limit of
  this project's own stands refused as well.
- The reference names the kind of the picture by the places of the words of the file rather than by words
  within it, so this port reads it for a file that names the kind of the picture and reads the head again when
  the picture is held.

## Tests

`tests/formats/adviz-biz-image.test.ts` covers the head of a picture, a picture whose places behind the head do
not stand for it, the walk of the places of a picture with the place of the walk of it, the palette read from
the two companions of the engine, the places of a picture stood out with the palette of the game it stands in
(with the places of the palette standing in the order of the places of a picture), a picture that stands with no
palette beside it, and the words of the file it is told by.
