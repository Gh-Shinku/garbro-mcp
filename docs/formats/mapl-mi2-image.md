# Mapl engine image (`MI2`)

* Reference: `GARbro/Legacy/Mapl/ImageMI2.cs` (`Mi2Format`, `Mi2Reader`), GARbro commit
  `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT.
* Port: `packages/formats/src/mapl/mi2-image.ts` (`maplMi2ImageFormat`, id `mapl-mi2-image`).
* Tests: `tests/formats/mapl-mi2-image.test.ts`.

## Layout

The file opens with the places of the file of the head of a picture of the kind of `BITMAPINFOHEADER`: the
count of the places of the file of the head of it at 0 (of the count of forty of them, of which the engine
stands of the mark of the picture), the width at 4 and the height at 8 (four places of the file each), the
count of the places of a colour at `0x0E` (eight or twenty four of them) and the count of the words of the
colour map of the picture at `0x20` (of `0x100` of them where it stands of nought). The places of the file of
the walk of the places of the picture stand at `0x28`, the colour map of the picture of eight places to a
place in front of them (`0x100` words of four places of the file each at the most).

The places of the picture stand of the walks of the places of the file in blocks of the eight places of the
block of them, of the count of the places of the file of a block (of the width of the picture of the count
of the places of the file of it of seven places of the file and of the place of the file of them behind), of
the count of the blocks of the width and the height of the picture of them; the places of the block of a walk
stand of the places of the file of the walk behind the places of it. The places of a block stand of the rows
of the block of them from the row of the file the last of them the first, of the count of the places of the
file of the row of the walk of the picture behind the place of the file of it.

A picture of eight places to a place stands of one walk of the places of the file; a picture of twenty four
places to a place of three of them, of the blue, the green and the red of every place of the picture, of the
places of the file of the walk of them behind one another.

## The walk of the places of the file

A walk of the places of the file stands of the count of the places of the file of the walk of a block of it
at the place of the file of the walk of it:

* a count of nought of the count of the places of the file: the block stands of the places of the file
  behind the count.
* a count of one: the block stands of the count of the places of the file of one place of the file behind it.
* a count of two and of eight: the block stands of the count of the places of the file of one place of the
  file behind it, of the places of the file behind it of the count of the places of the file of every row of
  the block of them (of eight places of the file to a row): the count of the places of the file of a row of
  the walk of it stands of the mask of it, of the place of the file of the count behind a mask of the walk
  standing of no place of the file.
* a count of three and of nine: the same, of two places of the file, of the places of the file of the mask
  of the walk of them.
* a count of four and of ten: the block stands of the count of the places of the file of three places of the
  file behind it and of the counts of the places of the block of them of two places of the file each
  (sixteen places of the file): the count of nought of a count stands of a place of the file of the walk, of
  the places of the file of the walk of the places of the file of the counts of them of one, of two and of
  three of them.
* a count of five and of eleven: the same, of four places of the file, of the counts of the places of the
  block of them of no place of the file.
* a count of six and of twelve: the block stands of the count of the words of the colour map of the walk
  behind the count of them (of the count of the places of the file of the walk of them), of the counts of
  the places of the block of them of three places of the file each (twenty four places of the file, the
  counts of them standing of the places of the file of the walk of the picture the highest place of the file
  first) and of the places of the file of the walk of the places of the block of them standing of no count
  of them.
* a count of seven and of thirteen: the same, of the counts of the places of the block of them of four
  places of the file each.
* a count of the places of the file of the walk of eight, of nine and of ten of the places of the file: the
  block stands of the places of the file of the walk of them of one place of the file of the row of the block
  of them standing of the counts of the places of the file of the block of it of one place of the file each
  (of the counts of the places of the file of the walk of the block of them behind the walk of the counts of
  them).

## Deviations

* **A walk of the places of the file standing short of the places of the file of the counts of the places of
  the picture of them and of the places of the picture.** Refused with `INVALID_ARCHIVE`; the reference
  reads the places of the file behind the walk (which stands of the places of the file of the walk of the
  count of the places of the picture of them and of the places of the file of the count of the places of the
  walk of them behind).
* **A walk of the places of the file of a count the engine knows none of.** Refused with `INVALID_ARCHIVE`;
  the reference throws its own refusal of it.
* **A picture of a colour map of no count of the words of the colour map of it.** The count of the words of
  the colour map of the picture of nought stands of the whole colour map of `0x100` of them, as the
  reference has it; a picture of eight places to a place of no colour map of the file stands of a colour map
  of the words of the file behind the places of the head of it, of noughts where they stand of none of them.
* **Packing a picture.** The reference stands of a format of its own, standing of no packer.
