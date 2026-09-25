# Black Cyc image (`DWQ`)

* Reference: `GARbro/ArcFormats/BlackCyc/ImageDWQ.cs` (`DwqFormat`, `ResourceHeader`, `DwqBmpReader`)
* Port: `packages/formats/src/black-cyc/dwq-image.ts`, record `black-cyc-dwq-image`
* Tests: `tests/formats/black-cyc-dwq-image.test.ts`

## Layout

The picture opens with a 0x40 byte header whose text at 0x30 matches `PACKTYPE=(\d+)(A?) +`. The kind named
by it decides what stands behind the header:

| kind | picture |
| --- | --- |
| 0 | a bitmap of the file itself |
| 1 | a bitmap of the runs of the engine |
| 2 | a bitmap of the file itself and a mask |
| 3 | a bitmap of the runs of the engine and a mask |
| 5 | a JPEG |
| 7 | a JPEG and a mask |
| 8 | a PNG |

For kinds 0, 5 and 8 the count of the places of the picture is the file length less 0x40; for 2, 3 and 7 it
stands at 0x20. The width and height stand at 0x24 and 0x28, the depth is always 32, and the base type is
the text at 0..0x10 trimmed.

A header whose first bytes read `IF PACKTYPE==`, whose bytes 0x0D and 0x2C read `0 ` and `BMP `, and whose
kind is 0 or 1, keeps its picture's measurements in the bitmap behind it instead. Kind 1 can only be read
from such a header: the switch that reads the measurements has no case for it.

## The bitmaps

* A bitmap of the file itself stands of the head of a bitmap of 0x36 bytes, whose width, height, depth
  (8, 16, 24 or 32) and colour count at 0x2E are read, and of its places behind it. Rows are padded to four
  bytes. From 24 bit up every place of a row stands of its red and blue places the other way round, and the
  reader swaps them back.
* A bitmap of the runs of the engine stands of the same head, of its colour map where its depth is eight,
  and of its runs from the offset at 0x0A. A nonzero byte is a place as it stands; a zero byte is followed
  by a count of places of nought. Rows are *not* padded: the stride is the width times the depth in bytes.
  Every place of a row then stands of the place above it (`place ^= above`).

## The mask

Where the picture stands of a mask and a mask is present (its offset is 0x40 plus the count of the places,
which must not be the end of the file), the mask is read as a bitmap of the runs of the engine. When its
depth is eight, its palette colour at every place names the alpha there: `(R + G + B) / 3`. The picture is
handed over at 32 bits per place with that alpha.

## Deviations

* **Kind 5 (JPEG).** The project has no JPEG reader, so the places are handed over as they stand.
* **Kind 7 (JPEG and mask).** Refused with `UNSUPPORTED_FEATURE`: the mask cannot be applied without a
  reader for the picture behind it.
* **A run of no places.** A count byte of nought would leave the reference reading for ever; the port
  refuses it, and a run that reaches beyond its row, with `INVALID_ARCHIVE`.
* **The mask of kinds 0, 5 and 8.** Those kinds take the count of their places as the file length less
  0x40, so the mask offset always stands at the end of the file and the mask is never applied. The port
  reads them the same way.
* **Sixteen places to a place behind a mask.** The reference converts the picture through WPF; the port
  expands red and blue by three places and green by two.
