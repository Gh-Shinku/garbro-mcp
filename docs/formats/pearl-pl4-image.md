# Pearl Soft image (`PL4`)

* Reference: `GARbro/Legacy/Pearl/ImagePL4.cs` (`Pl4Format`, `Pl4Reader`)
* Port: `packages/formats/src/pearl/pl4-image.ts`, record `pearl-pl4-image`
* Tests: `tests/formats/pearl-pl4-image.test.ts`

## Layout

The 0x10 byte head holds the mark `PL4 `, a version that must be 1, the kind of the walk at 6 (0 or 1),
the width in eight place units at 0xC and the height at 0xE. Sixteen colours of three places each stand at
0x10 (red, green, blue), each multiplied by 0x11, and the walks of the places begin at 0x40.

The picture is always eight places to a place, of the sixteen colours of its colour map. The walks write
four places at a time (eight for the walks of the second kind) and move down a row, so the walk covers a
group of columns from the top of the picture to the bottom and then moves to the next group.

## The walks of the first kind (0)

Every step reads two bytes into a 16 bit word (the first byte is the low half). Unless the first byte is
0x98, the word stands of four places: each of the four bytes of the output holds the four places of the
word that stand of one bit of every place, the lowest place of every byte being the highest place of the
word.

Where the first byte is 0x98:

* a following byte of nought means the word stands behind it: two more bytes are read and the word is read
  as it stands;
* otherwise the word names a run: a count of two to thirty three and a place of the picture, `(word >> 6)
  + 1` dividing into the column group at the top and the row behind it. Every place of the walk copies four
  places of the picture and steps down a row, wrapping at the bottom.

## The walks of the second kind (1)

A walk of bits. A set bit opens a run of the places of the picture, named by two more bits (the row two,
one or four behind, or the eight places behind) and a count. A clear bit stands of eight places as they
stand, which are read of a table of a hundred and fifty six places: every place of a picture stands of its
place in the table of the last place before it, of a code of one to four bits, and is moved to the front of
that table. The eight places of a step stand of four pairs, the first place of every pair standing in the
first four places of the step and the second in the last four.

## Deviations

* **A walk that stands short of the file.** The reference reads the places behind its walks as the places
  of a walk of nought; the port refuses the picture with `INVALID_ARCHIVE`.
* **A run of the places of the picture.** The wrap arithmetic of the reference is read as it stands, so a
  run stands of the four (or eight) places of the group of its own, of the row the walk names.
