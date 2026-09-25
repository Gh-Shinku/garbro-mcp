# Amuse Craft `GE ` picture

Format reference: GARbro `ArcFormats/Softpal/ImagePGD.cs`, class `PgdGeFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License).

A picture opens with the three bytes `GE `, the place of the picture on the screen (`i32` at 4 and 8),
the width (`u32` at `0x0C`), the height (`u32` at `0x10`) and the walk of the places of the picture of
the engine (`u16` at `0x1C`). The count of the places of the picture of the walk (`i32` at `0x20`), the
count of the places of the file of the walk of the engine (`i32` at `0x24`, unused) and the walk itself
stand behind the head of it. The reference stands of no walk of the places of the file of the head of
the picture of the engine: this port stands of the three bytes `GE ` of it.

The walk (`PgdReader.UnpackGePre`) is the one of the third and fourth kinds of the engine: a set
control reads a place of the file of the picture (`u16`) of the count of the places of the file of the
walk of it in the three lowest places of it, of the places of the file of the walk of the engine
(`u16`) in the twelve highest places of it, of a place of the file of the count of the places of it
behind them when the fourth place of the file of the first stands clear, of four places of the file of
the picture added to the count of them.

The walk of the places of the picture of the engine (of 1, 2 or 3) walks the places of the file of the
picture of the walk itself:

* **1** — the places of the file of the picture of the four places of the file of a colour to a place of
  the picture of it, of the colour of the walk of the engine first, of the red, of the green and of the
  colour of the places of the file of the place of the picture last. This port hands them over as the
  places of the file of a BMP of the four places of a colour to a place of it.
* **2** — the places of the file of the picture of the three places of the file of the table of the
  colour of it: two tables of the places of the file of the colour of the walk of the engine (of 226,
  -43, -89 and 179 of the places of the file of them) and a table of the places of the file of the
  picture, of the walk of the places of the file of the picture of the places of the picture of four of
  them. This port hands them over as the places of the file of a BMP of the three places of a colour to
  a place of it, of no places of the file of a colour of the places of the file of a place of it.
* **3** — the places of the file of the walk of the engine stand of the head of the picture of the
  second walk of it (`u16` of the places of the file of a colour of a place of the picture at 2, of the
  width at 4 and of the height at 6), of the places of the file of the picture of the third walk behind
  it.

The places of the file of the third walk of the engine stand of the walk of the places of the file of
the picture of the rows of it (`PgdReader.PostProcessPal`): a place of the file of the walk of every
row, of the places of the file of the picture of the walk of it of the places of the file of the
picture before it (the first place of the file of the row of the walk of the engine), of the row of
the picture above it, or of the places of the file of the two of them.

## What this port does not carry

* **Writing a picture of the engine.** The reference `PgdGeFormat.Write` throws.
* **A walk of the places of the picture of the engine of no places of the file of it.** The reference
  stands of `NotSupportedException`; this port stands of `UNSUPPORTED_FEATURE`.
* **A walk of the places of the file of the engine of the places of the file of the picture of it.**
  This port stands of `INVALID_ARCHIVE` for it.

## How the walk stands verified

Six walks of our own: the head of the picture of the engine (of the places of the file of it and of the
bytes of the mark of it), the three walks of the places of the picture of the engine of the three walks
of it, a picture of the engine of no places of the file of the walk of it, and the walk of the places of
the picture of the engine of no places of the file of the picture of the walk of it. The places of the
file of the picture of the second walk of the engine of this port and of a walk of the same reference
written apart from it stand of the same places of the file of the picture of both of them (of the four
places of the file of the picture of the four places of the file of a colour to a place of the picture
of it).
