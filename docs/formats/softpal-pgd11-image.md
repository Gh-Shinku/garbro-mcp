# Amuse Craft `11_C` picture

Format reference: GARbro `ArcFormats/Softpal/ImagePGD.cs`, class `Pgd11Format`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License).

A picture opens with the three bytes `GE\x1C`, the place of the picture on the screen (`i32` at 4
and 8), the width (`u32` at `0x0C`), the height (`u32` at `0x10`) and the letters `11_C` at `0x1C`.
The places of the file of the walk of the engine begin at `0x20` with the count of the places of the
picture of the walk (`i32`), the count of the places of the file of the walk of the engine (`i32`,
which the reference reads and does not use) and the walk itself.

The walk (`PgdReader.Unpack`) is the one of the two first kinds of the engine: a control byte of the
places of the file of it read from the lowest place of the file of it up, `readByte() | 0x100` again
when the control stands of one. A set control reads a place of the file of the picture (`u16`) and a
count (`u8`) and copies the places of the file of the picture of the walk of the engine behind the
places of the file of the picture of the engine (`dst - 0xFFC` once the walk stands behind them); a
clear control reads a count (`u8`) and copies that many places of the file of the picture itself. The
places of the file of the picture of the walk stand of the four places of the file of a colour to a
place of the picture of it — the colour of the walk of the engine first, of the red, of the green and
of the colour of the places of the file of the place of the picture last — which this port hands over
as the places of the file of a BMP of the four places of a colour to a place of it.

## What this port does not carry

* **Writing a picture of the engine.** The reference `Pgd11Format.Write` throws.
* **A walk of the places of the file of the engine of the places of the file of the picture of it.**
  The reference reads the places of the file of the walk of the picture of the engine outside the
  places of the file of the picture of it, of the places of the file of it of no places of the engine;
  this port stands of `INVALID_ARCHIVE` for it.

## How the walk stands verified

Three walks of our own: the head of the picture of the engine (of the places of the file of it, of the
letters of the head of it and of a head of no places of the file of it), the walk of the places of the
picture of a run of the places of the file of it, and the walk of the places of the picture of a match
of the places of the file of the walk of the engine of the picture before it. The places of the file of
the picture of the engine of the second walk — the places of the file of the walk of the engine of the
places of the picture of the file of the walk of it of the first place of the picture of the engine —
stand of the places of the file of the walk of both readings of the reference.
