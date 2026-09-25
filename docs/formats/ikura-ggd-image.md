# Digital Romance System indexed image (GGD)

* Reference: `ArcFormats/Ikura/ImageDRG.cs` (classes `DrgIndexedFormat` and `GgdMetaData`), GARbro commit
  `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.
* Local id: `ikura-ggd-image`; tag `GGD`; extension `.ggd`.

## Head

The picture opens with the mark `256G` of the places of the file the other way around (the reference holds
`~0x47363532`), then the places of the head of the picture (of the places of the file of the table of the
colours of it), the width, the height (of the places of the picture the other way up where it stands of
nought or of fewer places of them), eight places of the file of no walk of their own, and the count of the
places of the picture of the walk of it.

## The table of the colours and the walk of the places

The table of the colours of the picture stands at the places of the file of the head of the picture (one
taken off the places of the file of the mark), of four places of the file to a place of a colour of it
(blue, green, red and no place of an alpha). Four places of the file behind the table stand of no walk, and
the walk of the places of the picture stands behind them: of the walk of the places of the file of the
engine itself (`LzssReader`, of the frame of the places of the file of `0x1000` of them, of no places of
the file of the frame behind it, and of the places of the file of the frame of `0xFEE` of them).

The places of a row of the picture stand of the places of the width of it, of the places of the file of the
row behind them: this port hands the places of the row over to the bitmap of the picture, of the places of
the file of the row behind them.

## What this port does not carry

* **A walk standing short of the file of the picture, and a table of the colours standing beyond the places
  of the file of it.** Both stand of `INVALID_ARCHIVE` here; the reference reads the places of the file
  behind the walk, and of `InvalidFormatException` where the table of the colours stands short of the file.
* **The places of the picture of the head of it standing of the places of the picture the other way up.**
  The reference names the places of the picture the other way up of a head naming the height of the picture
  of nought or of fewer places of them, and then stands of no walk of the places of the file of its own: this
  port stands of the places of the file of the picture as they stand, and records the places of the picture
  the other way up in the places of the entry of it.
* **Packing a picture.** `DrgIndexedFormat.Write` stands of no walk of it in the reference.

The walk of the places of the file of the indexed picture of the engine stands of the places of the file
of the picture of the walk of the engine of the count of the places of the picture of it. A picture of
the places of the file of 64 and 68 of them stands of the places of the file of the walk of the engine
of `0x1100` places of the file of the picture of the walk of it (of more than `0x1000` of them), of the
places of the picture of the walk of the engine itself at the two ends of the picture of it.

## How the walk stands verified

Three pictures of our own stand of the walk of the engine: the head of the picture (of the places of the file
of the table of the colours of it), the table of the colours and the walk of the places of the picture (of
the walk of the places of the file of the engine), and the places of the picture the other way up.
