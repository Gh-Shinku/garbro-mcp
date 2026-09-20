# ADVIZ engine image format

Reference: `GARbro/Legacy/Adviz/ImageBIZ.cs`, class `BizFormat` and its palette reader. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/adviz/biz-image.ts` (`advizBizImageDescriptor`,
`advizBizImageFormat`, id `adviz-biz-image`, `readBizLayout`, `unpackBizPicture`, `readBizPalette`,
`decodeBizPicture`) over the palette of the engine in `packages/formats/src/adviz/palette.ts`
(`readAdvizPalette`, `PALETTE_MAPPERS`), which is meant to serve `GIZ/2` as well.

## The picture

it, one place for every place of the picture: the reference refuses a picture whose places behind the head do
walked — every stored place stands beside the place of the walk, and the place of the walk then stands for the
upwards.

## The palette, which stands beside the game rather than within the picture

palettes of them. A record of `GRP_TBL.SYS` holds twelve places: eight places of words and four behind them.
The reference stands the words of the picture in that record to find the place of a palette, with three
quirks that this port keeps:

  picture of that person, so that the place of the kind of the picture stands behind them (the words stand
  matched against the words of the picture as they stand, with the kind of the picture standing at the end);
- the reference stands the words of a picture that stand short of the words of a place of the words of the
  engine padded with **one** place, whatever the places they stand short of them, so that the words stand
  matched against the first places of a record only where they stand short;
  and where that place stands beyond the palettes of the table of palettes the reference stands the place of
  shortened by one.

names one: the table `PALETTE_MAPPERS` holds the kinds of the engine, one naming the place of a palette of a
palettes of the engine shifted by two and fifty places. A picture stands with a place of its own where the
table names no kind. Where the reference stands the words of a picture beside the table it stands them for the
words of a picture stand on the words of the picture itself.

## Deviations from the reference

  a picture of its own.
- The reference throws where the two companions of the engine stand absent or where no record of
  `GRP_TBL.SYS` names the picture; this port refuses the picture with a `GarbroError` naming the palette.
- A picture of no places stands nowhere and is refused, and a picture whose places would stand past a limit of
  this project's own stands refused as well.
  within it, so this port reads it for a file that names the kind of the picture and reads the head again when
  the picture is held.

## Tests

`tests/formats/adviz-biz-image.test.ts` covers the head of a picture, a picture whose places behind the head do
palette beside it, and the words of the file it is told by.
