# "Pandora.box" image format

Reference: `GARbro/ArcFormats/Pandora/ImageXL24.cs`, class `Xl24Format` (namespace `Terios`). GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/pandora/xl24-image.ts` (`pandoraXl24ImageDescriptor`,
`pandoraXl24ImageFormat`, id `pandora-xl24-image`, `readXl24Layout`, `unpackXl24`).

The reference signs the format with the word `0x34324C58`, the four letters `XL24`, and declares the `bmp`
extension beside it, which is the name these pictures are stored under. Four bytes behind the letters stand
skipped, then two words hold the measurements, and the stream of the picture begins right behind them at
`0x10`. The depth is always reported as twenty four bits, whatever the file holds; the port reports the same
and refuses a picture of no width or height, which the reference would hand on as an empty one.

`Xl24Format.Read` walks the stream a row at a time, **from the bottom row of the picture up**, and every row
but the bottom one is exclusive-or'd with the row below it once it stands — the reference tests the offset of
the previously walked row against nothing, which is the same thing, since only the bottom row is ever walked
first. A row is a run of pixels whose control byte says what to do:

| control | what it does |
| --- | --- |
| `0x00` | skips a byte behind it plus two pixels |
| `0x01` | skips one pixel |
| `0x80` | ends the row |
| `0xFF` | puts down one pixel and carries it through the rest of the row |
| above `0x80` | puts down one pixel and carries it through that many pixels past the first |
| below `0x80` | puts down that many pixels themselves |

The colours of a carried pixel are copied with the overlap the reference uses, which is what makes the pixel
the run started with repeat. A row that reaches past its own end writes into the row below it, which is a row
the walk has already been through — so the bytes stay, up to the exclusive-or that the row reaching into it
goes through right afterwards. A stream that stops where a control byte is wanted is refused, while a payload
that stops early simply leaves the rest of the pixel as it stands, the way the .NET stream the reference reads
from does (a documented deviation in the message only). A picture whose pixels would take more than 256
megabytes is refused rather than allocated, where the reference would run out of memory.

The write path of the reference throws `NotImplementedException`, so this is a read only format, and the
decoded rows are written out as a bitmap stored from the top down — the row the stream begins with is the
bottom row of the picture, and it is the last row of the bitmap.

The tests cover the four letters of the signature, a picture of no width or height, the measurements and the
depth the reference always reports, the rows unfolded from the bottom row up, a stream that puts down nothing,
a row ended where the stream says so, one pixel carried through the rest of a row and through as many pixels
as the control says, every row exclusive-or'd with the one below it, a row running past its own end into the
row below, a pixel the stream stops inside of, the refusal of a stream that stops where a control byte is
wanted, of a run that reaches past the picture and of a picture too large to hold, and a row of raw pixels
unfolded the way the reference walks it.
