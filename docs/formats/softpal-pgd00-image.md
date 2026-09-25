# Amuse Craft `00_C` picture

Format reference: GARbro `ArcFormats/Softpal/ImagePGD.cs`, class `Pgd00Format`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License).

A picture opens with the place of the picture on the screen (`i32` at 0 and 4), the width (`u32` at 8),
the height (`u32` at `0x0C`) and the letters `00_C` at `0x18`. The count of the places of the picture
of the walk (`i32` at `0x1C`), the count of the places of the file of the walk of the engine (`i32` at
`0x20`, unused by the reference) and the walk itself stand behind the head of it. The reference takes
a picture of the places of the file of the letters `00_C` of the head of it alone; this port stands of
the same test and of no places of the file of the walk of the engine of no places of the file of it.

The walk is the one of the first kind of the engine, of the count of the places of the file of the
picture of the walk of 3000 places of the file of it instead of `0xFFC`. The places of the file of the
walk of the engine stand of a **Truevision Targa picture**, which the reference hands to its own TGA
reader; this port hands the places of the file of the walk of the engine to `renderTgaImage` of the
TGA picture of the engine itself and returns the places of the file of a BMP of it.

## What this port does not carry

* **Writing a picture of the engine.** The reference `Pgd00Format.Write` throws.
* **A walk of the places of the file of the engine of the places of the file of the picture of it.**
  This port stands of `INVALID_ARCHIVE` for it, as the first kind of the engine stands of it.

## How the walk stands verified

Two walks of our own: the head of the picture of the engine (of the places of the file of it and of a
head of no places of the file of it) and the walk of the places of the picture of the TGA behind it. The
TGA of the picture of the walk of the engine stands of a picture of the TGA picture of the engine of
this port, of two rows of the places of six places of the file of a colour to a place of the picture of
it, of the places of the file of the picture of the rows of the BMP of it behind them.
