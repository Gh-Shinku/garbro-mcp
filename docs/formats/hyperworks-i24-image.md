# HyperWorks RGB image (`I24`)

Format reference: GARbro `Legacy/HyperWorks/ImageI24.cs`, classes `I24Format` and `I24Decoder`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License).

## Head

A picture opens with the four bytes `I24A` or `I24 `, the width (`u16` at `0x0C`), the height (`u16` at
`0x0E`) and the places of the file of a colour of a place of the picture (`i16` at `0x10`, of the 24
places of the file of it alone). The fourth place of the file of the mark stands of the walk of the
places of the table of a row of the engine. The walk of the places of the file of the picture of the
engine begins at `0x18`.

## The walk of the places of the file of the picture

The walk reads the places of the file of the picture of the engine of a reservoir of the places of the
bits of it (`bits`, `bitCount`), of the two first places of the file of the walk of the engine and of
the walk of the places of the file of the tables of the engine itself.

Every `0x3FFF` tokens of the places of the file of the walk of the engine the three tables of the walk
of the engine stand again of the places of the file of the walk itself:

* `InitTree` reads the count of the places of the file of the walk of the tree of the engine and the
  places of the file of the depths of the places of the file of the walk of it (`GetBitLength` and
  `GetBits`), of the places of the file of the walk of the engine of the places of the file of the
  table of the walk of it of no places of the file of the rest.
* `RebuildTree` walks the places of the file of the depths of the places of the file of the walk of the
  engine (`341`, `10` and `250` places of the file of them) and stands of the table of the tokens of the
  walk of it: a table of `256` places of the file of the picture of the walk of the engine, of the
  places of the file of the tokens of the depths of it of no places of the file of the walk of the
  engine above the eight places of the file of a place of the picture of it (`Link`).

Every place of the picture of a row of the walk of the engine stands of the two tables of the walk of
it: the places of the file of a colour of a place of the picture (of `216` or above: the places of the
file of a run of the places of the picture of the count of the token behind `214` places of the file of
it; of no places of the file of it: the places of the file of the colour of a place of the picture
before the walk of it of the places of the file of the three tables of the colour of the walk of the
engine) and the places of the file of a place of the walk of a row of it (a pair of the table of the
places of the file of the walk of the engine: the place of the file of the picture of the walk of the
colour before the walk of the engine and the row of the picture of the walk of it, of the three rows of
the places of the file of the walk of the engine itself).

The table of the places of the file of the walk of a row of the engine (of `22` places of the file of
it) stands again of every token of the walk of the engine: of the letters `A` of the mark of the
picture of the engine the places of the file of the token stand at the front of the table of the walk
of a row of it, of no places of the file of them the places of the file of the token stand of the
places of the file of the walk of the engine above it. A place of the file of the colour of the walk of
the engine of `-3` stands of a token of the third table of the walk of the engine (`+3` places of the
file of it).

The three rows of the places of the file of the walk of the engine stand of the row of the picture of
the engine of the places of the file of the walk of the engine itself, of the four places of the file
of a colour to a place of the picture of it (of the places of the file of the colour of the walk of the
engine first, of the red, of the green and of the colour of the places of the file of the place of the
picture last, of no places of the file of a colour of the places of the file of the colour of it). This
port hands the places of the file of the picture of the engine over as the places of the file of a BMP
of the four places of a colour to a place of it.

## What this port does not carry

* **Writing a picture of the engine.** The reference `I24Format.Write` throws.

## Where this port stands of the walk of the places of the file of the engine

The reference stands of no guard of many walks of a picture of the engine: a place of the file of the
walk of the tree of the engine outside the table of the walk of it, a place of the file of the tree of
the walk of the engine of no places of the file of it, the walk of the places of the file of the walk of
the engine outside the places of the file of the table of the tokens of it, and a place of the file of
the walk of the engine of a picture of no places of the file of it stand of the places of the file of
the walk of the engine behind the places of the file of it in the reference. This port stands of
`INVALID_ARCHIVE` for each of them. The places of the file of the walk of the engine behind the places
of the file of the picture of it stand of `0xFF`, as the place of the file of the walk of the engine of
the reference of the places of the file of the picture of the engine itself (`(byte)ReadByte()`).

## How the walk stands verified

Six walks of our own: the head of the picture of the engine (of the two marks of it, of the places of
the file of a colour of a place of the picture of it alone and of a head of no places of the file of
it), the walk of the places of the file of the picture of the engine, the walk of the places of the
file of the table of the walk of a row of it of the two kinds of the walk of the engine, and the walk
of the places of the file of the picture of the engine of the file of the places of it.

The reference stands of no walk of the places of the file of a picture of the engine, so the picture of
the walk of the places of the file of the test of this port stands of a walk of the places of the file
of the engine written for it: the places of the file of the three tables of the walk of the engine (of
the places of the file of the colours of the tokens `91` and `216`, of the places of the file of a row
of the token `1` and of the third table of the token `0`) and of the tokens of the places of the file of
the three places of the picture of the engine (of a colour of the table of the engine and of the run of
two places of the picture behind it). The places of the file of the picture of the engine of the walk of
this port and of a walk of the same reference written apart from it stand of the same places of the file
of the picture of the engine itself (`02 00 01 00` of the three places of the picture, of the walk of
the places of the file of the table of a row of the engine of the token `1` behind the walk of the
places of the file of the colour of a place of the picture of it).
