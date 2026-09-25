# KAAS engine image (`PIC/KAAS`)

* Reference: `GARbro/ArcFormats/Kaas/ImageKAAS.cs` (`PicFormat`, `PicFormat.Reader`), GARbro commit
  `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT.
* Port: `packages/formats/src/kaas/pic-image.ts` (`kaasPicImageFormat`, id `kaas-pic-image`).
* Tests: `tests/formats/kaas-pic-image.test.ts`.

## Layout

The file opens with the walk of the places of the file of the picture at 0 (five, six, eight and nine of
them), the counts of the scramble of the picture at 1, the width and the height of it at 2 and 4 (two places
of the file each, of no count above `0x1000` of them), the count of the places of the file of the walk of the
controls of the picture at 8 and the count of the places of the file of its second walk at `0x0C`. The third
walk stands behind them, of the count of the places of the file of the picture less `0x12` places and the
counts of the two walks of the head of it.

The places of the picture stand of the three places of a place of it, of the places of the file of the three
walks behind the head of it: of no walk of them at all where the walk of the picture stands of six (the
places of the picture stand of the places of the file themselves then, of the counts of the scramble of them
behind).

## The walks of the places of the file

* **The walk of five places to a count** stands of the places of the file of the controls of it, of two
  places of the file to a count of the walk: a count of nought stands of one place of the file of the
  picture as it stands, a count of one of a count of the places of the picture (four places of the file, of
  two places more than the count of them stands of) and of a place of the file of the count of the walk of
  the places of the picture; a count of two of a word of the places of the file of the walk of the picture
  itself (of the count of the places of the walk of the places of the picture of four places of the file and
  of a count of the walk of them of twelve places, of two places more than the count of them stands of; the
  word of nought ends the walk); a count of three of a count of the places of the picture of the places of
  the file of the counts of the walk of them (eight places) and of a place of the file.
* **The walk of eight and nine places to a count** stands of the places of the file of the controls of it, of
  two places of the file to a count of the walk, of the places of the file behind one another in a place of
  the file: a count of nought stands of the places of the file of the walk of the picture itself (three
  places of the picture of it, of a count of the places of the file of the walk of nine places of the
  picture behind it), a count of one of a place of the file and of the four places of the file behind it, a
  count of two of a word of the places of the file and a count of three of a word of the places of the file
  and of the four places of the file behind it, of the word of nought ending the walk of them. The counts of
  the places of the walks of them stand of the places of the file of the counts of the walk of the picture,
  of a count of the places of the picture, of three places of the file to a place of the file of the walk
  (`count = (field + 1) * 3` of the counts of one and two of them and `(field + 5) * 3` of the count of
  three of them).

## Deviations

* **A walk standing short of the places of the file of the counts or of the places of the picture of it, and
  a walk standing beyond the places of the picture.** Refused with `INVALID_ARCHIVE`; the reference reads the
  places of the file behind the walk of the picture (which stands of the places of the file of the walk of it
  of the count of the places of the picture of them and of the places of the file of the count of the places
  of the walk of them behind).
* **A picture of a walk the engine knows none of.** The head of the walk of the places of the file stands of
  no count of the places of the file of the walk of them of its own, of no walk of the places of the file of
  the picture.
* **Packing a picture.** The reference stands of a format of its own, standing of no packer.
