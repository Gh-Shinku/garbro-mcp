# Adobe Photoshop image (`PSD`)

Reference: GARbro `ArcFormats/Adobe/ImagePSD.cs`, class `PsdFormat` with the `PsdReader` that unpacks through
it (GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License). Implemented as
`packages/formats/src/adobe/psd-image.ts`, registered as `adobe-psd-image`.

## The header

The file opens with `8BPS` and a version that must be one, and then, in big endian order, the number of
channels -- one to fifty six -- the height, the width, each capped at thirty thousand by the reference, the
depth of one channel and the colour mode. The depth the picture reports is the channels times the depth of
one of them, which is how the reference decides whether a palette stands in front of the pixels.

## What stands behind the header

Three sections, each behind its own big endian length: the colour mode data, the image resources, and the
layer and mask information. The pixels begin with the word that names their compression:

* **nothing**: the bytes behind it are the pixels, taken whole;
* **run length coded**: the lengths of the packed rows stand first, one big endian word to a row of every
  channel in turn, and the rows follow in the same order. A control byte of nothing to one hundred and twenty
  seven stands for that many plus one bytes as they are, and one below nothing stands for `1 - count` copies
  of the byte behind it.

Any other compression is refused, as the reference refuses it (it names ZIP and does not read it).

## The channels

The stored channels run one behind the other, and the picture is written out of them channel by channel. **The
file keeps red first and a bitmap keeps blue first**, which is the one order the reference turns around: the
first stored channel goes to the third byte of a pixel, the second to the second, the third to the first, and
a fourth to the alpha byte. A picture of more than four channels is read four channels deep, which is what the
reference reads whatever the count says.

## What this port writes

| mode | depth | written as |
| --- | --- | --- |
| bitmap (`0`) | one bit | a one bit bitmap of black and white |
| greyscale (`1`) | eight bits | a bitmap with the grey ramp a picture of no palette gets |
| RGB (`3`) | eight bits | three channels blue first, four when the file carries an alpha |

The reference reads a greyscale picture of sixteen bits through WPF as well; this port refuses it, as it
refuses indexed, CMYK and the other colour modes the reference does not read either.

## Deviations from the reference

* A control byte of `-128` is refused: the reference reads it as neither a run nor a repeat and loops on it
  **for ever**. A run that would carry a row past its own length, a row that reaches past the file, a plane
  that does not hold all of its pixels and a section that does not fit are refused with `INVALID_ARCHIVE`.
* The pixel bytes are read whole rather than a count worked out from the header, which matters for a bitmap of
  one bit a pixel: its rows are rounded up to whole bytes, so the reference's own channel size is short.
* The palette the reference reads for a greyscale picture is not read here, since the modes this port writes
  do not need one.
* A picture larger than 256 MiB is refused rather than allocated.

## Verification

Nine fixtures in `tests/formats/adobe-psd-image.test.ts` cover the three channels turned into a bitmap's
order, a fourth channel kept as the alpha, a picture of five channels read four deep, a greyscale picture and
its ramp, a bitmap of one bit a pixel over two rows, rows that are run length coded, the listing and its
metadata, and the headers, colour modes, depths and streams that are turned away.
