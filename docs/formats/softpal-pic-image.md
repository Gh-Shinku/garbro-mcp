# Softpal engine image (`PIC/SOFTPAL`)

* Reference: `GARbro/ArcFormats/Softpal/ImagePIC.cs` (`PicFormat`, `PicReader`), GARbro commit
  `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT.
* Port: `packages/formats/src/softpal/pic-image.ts` (`softpalPicImageFormat`, id `softpal-pic-image`).
* Tests: `tests/formats/softpal-pic-image.test.ts`.

## Layout

The file opens with the count of the places of a colour of the picture at 0 (one, three and four of them
standing of eight, twenty four and thirty two places of the file to a place of it), the width at 2 and the
height at 4 (two places of the file each), the count of the places of the file of the blocks of the width of
the picture at 6 and of the height of it at 7 (of the count of the places of the file of the picture of it
standing of the blocks of them of eight places of the file each at the least). The counts of the walks of the
picture stand at 8, of one place of the file to a block of the picture: the counts of the blocks of the
height of the picture stand of the rows of the file of the block of them the last of them the first. The
walks of the places of the file of the blocks stand behind the counts of them.

The picture of the engine stands of the blocks of the count of the places of the file of the eight places of
the block of them, of the places of the file of a block of it of the count of the places of the file of the
walk of the block of it at the place of the file of the walk of the blocks of the picture behind.

## The walk of the places of the file of a block

A walk of a block stands of the count of the places of the file of the walk of the block of it:

* of the count of the places of the file of the walk of the whole block of the picture of eight places to a
  place: of the counts of the places of the file of the block — of the places of the file of the counts of
  two places of the file each (of the counts of them of the counts of the file of the places of the file of
  them the other way round) and of the counts of the places of the file of the walk of them, of the counts
  of the file of the walk of them of the counts of the counts of the counts of the file of them above them.
* of the counts of the places of the file of a block of the picture of twenty four and of thirty two places
  to a place: of the counts of the places of the file of three of them behind one another — the counts of
  the six places of the file of the walk of them standing of the counts of the places of the file of the
  walk of the block of them, of the counts of the places of the file of the walk of the counts of the file
  of the walk of them behind — and of the counts of the places of the file of the walk of them, of the
  counts of the file of the walk of them of the counts of the counts of the counts of the file of them above
  them as well.
* two counts of the places of the file of the walk of the whole block of the picture of eight places to a
  place stand of the counts of the places of the file of the block of them standing of nought and of the
  whole place of the file of it.

The places of the file of the walk of a block of the picture stand of the places of the file of the counts
of the walk of them of the counts of the places of the file of the walk of the block of them behind the
counts of the walk of the block of the picture of the whole place of the file: the counts of the walk of the
places of the file of a block stand of the counts of the file of the block of them the other way round, of
the counts of the places of the file of the walk of the block (of the count of the places of the file of the
counts of the walk of it of one place of the file, of two places of the file of it where the count of the
places of the file of the walk of the block of them stands above the count of the places of the file of the
walk of them).

The walk of the places of the file of the block of the picture then stands of the counts of the places of
the file of the block of it, of the counts of the walk of the block of them of the counts of the places of
the file of the block of them the other way round, of the count of the places of the file of the walk of the
block of the picture of a place of the file at the place of the picture of the places of the file of the
walk of the block of it.

## The places of the file of the walk of the channels

A picture of twenty four and of thirty two places to a place stands of the places of the file of the walk of
the blocks of the picture of the channels of the block of them: the counts of the places of the file of the
walk of the block of the picture stand of the counts of the file of the block of them of the counts of the
channels of the block of the picture, of the counts of the places of the file of the walk of the block of
every channel of the places of the file of the walk of the block before it. The places of the file of the
channels of the block of the picture stand of the count of the places of the file of the block of the walk
of them, of the places of the file of the walk of the channels of them: the blue, the green and the red of
them of a picture of twenty four places to a place, and the alpha, the blue, the green and the red of them
of a picture of thirty two places to a place.

The places of the picture stand of the blocks of the walk of the places of the file of it of the row of the
file of the block of them the last of them the first, of the count of the places of the picture of it.

## Deviations

* **A walk of the places of the file standing short of the places of the file of a block of the picture.**
  Refused with `INVALID_ARCHIVE`; the reference reads the places of the file behind the walk.
* **A picture of the count of the places of the file of the walk of a block of the picture of the counts of
  the places of the file of the whole block of a picture of eight places to a place above the two counts of
  the walk of the whole block of it.** The places of the file of the block of the picture stand of the
  counts of the walk of the block behind the count of the places of the file of the walk of them, as the
  reference has it; the places of the file of the counts of the walk of them of no count of the places of
  the file stand of the places of the file of the block of the walk of the block of it.
* **A picture of eight places to a place.** The reference stands of the counts of the places of the file of
  the picture itself (`PixelFormats.Gray8`); the port stands of the counts of the places of the file of the
  picture from the black of it to the white of it.
* **A picture of a count of the places of a colour the engine knows none of.** The head of the walk of the
  places of the file stands of no walk of the places of the file of the picture.
* **Packing a picture.** The reference stands of a format of its own, standing of no packer.
