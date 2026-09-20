# Majiro game engine indexed image format

Reference: `GARbro/ArcFormats/Majiro/ImageRC8.cs`, classes `Rc8Format` and `Rc8Format.Reader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/majiro/rc8-image.ts` (`majiroRc8ImageDescriptor`,
`majiroRc8ImageFormat`, id `majiro-rc8-image`, `readRc8Layout`, `unpackRc8`).

The word `0x9A925A98` stands at nought with the mark `8_00` behind it, the width and the height stand as
words from eight and may not pass `0x8000`, and the depth is always reported as eight bits. The colour map of
two hundred and fifty six three byte entries stands at `0x14` — red, green and blue — and the runs behind it,
a byte a pixel of the picture.

`Reader.Unpack` builds the picture from runs of two kinds, one after another:

* a run of the **first** kind stands itself, and holds one byte more than the count the last run left behind,
  which is nought at the start. A run may therefore say its own length by standing as a byte below `0x80`
  first, and the byte `0x7F` says that two more bytes hold the rest of the count;
* a run of the **second** kind reaches **back** into the picture. The control's high bits choose a place of
  the shift table, its low three bits hold one less than the length — with seven saying that two more bytes
  hold the rest — and the place stands behind the picture by the table's own count of rows and places, whose
  low nibble counts rows and whose rest counts places along a row.

Every run of the second kind therefore has to reach back, and may not reach before the start of the picture;
the reference refuses a place at or after the picture and one before its start alike.

Deviations from the reference, in the message only: a run that says more bytes than the picture still holds,
a run that reaches outside it, and a stream that is cut short are refused with messages of this project's
own, where the reference throws format exceptions of its own. The write path of the reference throws
`NotImplementedException`, so this is a read only format.

The tests cover the head, the marks and measurements it is turned away for, runs that stand and runs that
reach back, a count taken from the two bytes behind seven, a place that does not reach back, a stream that is
cut short, and the picture written out with its colour map.
