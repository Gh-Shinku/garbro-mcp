# HyperWorks indexed image (`G`)

Format reference: GARbro `Legacy/HyperWorks/ImageG.cs`, classes `GFormat` and `GReader`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License).

## Head

A picture opens with twelve bytes: the words `0x7D00` and `0x1A47`, the place of the picture on the
screen (`i16` at 4 and 6), the width (`u16` at 8) and the height (`u16` at 10). The reference accepts
a picture when the second word is `0x1A47` and either the first word is `0x7D00` or the name of the
file carries the letters `.G`; this port keeps that rule, and passes the name of the file into the
reader for it.

The table of the colours sits at `0x0C` and holds 48 bytes, of sixteen colours of three places of the
file of them. The reference reads the sixteen colours through a table of places of the file of it
(`0, 1, 4, 5, 2, 3, 6, 7, 8, 9, 0xC, 0xD, 0xA, 0xB, 0xE, 0xF`), spreads every place of the file of a
colour to four bits (`R |= R << 4`) and writes the colour to the places 10 to 25 of the table of the
picture. The places 26 to 41 hold the same colours of half of them, of the walk of the reference
`(sbyte)v >> 1`, of the places of the file of an odd place of it added back to them.

## The walk of the places of the file of the picture

The walk starts at `0x40`, of the two first places of the file of it as a reservoir of the places of
the walk (`SetupBitReader`), and covers the picture in blocks of two rows of the places of the file of
the walk of it: the width of a block row is `(width + 7) & -8`, of two places of the picture to a place
of the engine, and the height is `(height + 1) & -2` rows to two.

Every place of the picture of a block row is either

* a colour of the table of the engine, of the control bit 1 and of the four places of the file of the
  tables `BitTable3` of it (`GetColorFromTable`), of the colour of the places of the picture above it
  and of the places of the file before it, or
* a run of the places of a picture of the walk of the engine, of the control bit 0: `BitTable1` holds
  the count of the places of the run (of a second table of it added to it when the count stands of
  `0x40` or above), and `BitTable2` holds a place of the table `OffTable` of the walk of a colour of
  the picture before the walk of it, of the row and of the place of the run.

`ExtractBits` reads the tables of the walk of the engine of the next eight places of the file of the
reservoir: a table entry of no places of the file of the walk of it hands the walk to a tree of the
places of `OffTable` (the places 54 and above of it), of one place of the file of the walk of the
engine to a step.

Every row of the walk of the engine holds two rows of the picture: the value of a place of the block
row goes to the rows `2y` and `2y + 1` of it, of the two places of the file of a colour of a place of
the picture of it (`+ 0xA0A`), of the low places of the file of the value on the row of the places of
the file before it and of the high places of it on the row behind it.

## What this port does not carry

* **Writing a picture of the engine.** The reference `GFormat.Write` throws.
* **A picture of the engine of a run before the walk of the picture of it.** The reference reads the
  places of the file of the picture before the walk of it, of the places of the file of no places of
  the engine of it (a walk of the places of the file of the picture of the engine outside the places
  of the file of it in the reference); this port stands of `INVALID_ARCHIVE` for it.
* **A picture of the engine of no places of the file of the walk of it.** The reference stands of the
  places of the file of the walk of it behind the places of the file of the picture, of the places of
  the file of no places of the engine; this port stands of `INVALID_ARCHIVE` for it.

## How the walk stands verified

Seven walks of our own: the head of a picture of the engine (of the words of the head of it, of the
letters of the name of the file of it and of the places of the file of it alone), the table of the
colours of it (of the places of the file of the table of 42 of them), the walk of the places of the
file of the picture of the engine of a colour of the table of it and of the runs of the places of the
file of it, a walk of the places of the file of the walk of the engine of the places of a picture of
it, and the walk of the places of the file of the engine of a run before the walk of the picture of it
of no places of the file of the engine.

The places of the file of the picture of the engine of this port and of a walk of the same reference
written apart from it stand of the same places of the file of the picture of both of them: the first
picture (a colour of the table of the engine, of the runs of the places of the file of it behind the
walk of it) stands of the places of the file of the walk of `0D 0A` and of the places of the file of
the table of the colours of it, and the second picture (of the places of the file of the walk of the
engine of the places of the colours 14 and 15 of the table of it) stands of the same places of the
file of the walk of both of them.

The walk of the places of the file of the table of the colours of the engine of the reference stands of
the places of the file of the *low* places of the table of the colours of the picture to a place of the
picture of the engine, of no places of the file of the high places of it: the places of the file of the
walk of the places of the file of the table of the colours of this port caught that of the walk of the
places of the file of the table of the colours of the engine of the two places of the file of the
picture of it of the ports of the other engines.
