# ScrPlayer picture (`IMG`)

Format reference: GARbro `ArcFormats/ScrPlayer/ImageIMG.cs` (`ImgFormat`, `ImgReader`, `ImgBitStream`),
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## Head

| place | field |
| --- | --- |
| 0 | the mark `IMG ` |
| 0x0C | the width and the height of the picture (`u16` each) |
| 0x10 | the places of a colour of it (`u16`): twenty four or thirty two |
| 0x18 | the places of the walk |

A picture of any other count of places, or of a row wider than the window of the walk, is turned away.

## The walk of the places of a code

The stream stands of **codes of a table**: the walk peeks the window of a table - thirteen places for the
codes of the places of the picture, five for the places of a code, eight for the places of a difference -
and stands of the entry the window names, of which it takes the **count of the places of the entry alone**.
The places of the window behind that count are therefore read again by the code behind it, which is what
makes the tables of the engine the tables of the codes of its own walk.

The cache of the walk reads a byte of the stream from the **highest place of it down**, of a table of the
places of a byte of its own (`ByteMap`).

A code of the places of the picture of `0xD8` and above hands the places of it as they stand, of a count of
the code less `0xD6`, and a code of `0xEF` stands of eleven places more behind it.

## The window of the walk

The places of the picture are turned out a row at a time, of **three rows of `0xC80` places** that stand one
over the other: the row of the walk is turned over with the one behind it as every row begins, so a place
turned out stands of the row of the walk, of the row in front of it or of the one in front of that. The
place of a code within the window stands of a second table of codes, whose places are pairs of a place
within a row and of a row of the window.

The table of the places a code reaches back to carries the pair it read **to the front of itself**, so a
place that stood behind another stands of a shorter code afterwards.

## The places of a colour

A place of a colour of a code stands of the place it reaches back to **less** the places of a table of its
own, or less a **difference** read of a walk of its own where the table of the colours of the code names
one: a difference of `0x2B` stands of thirteen places more behind it, and the place it turns out stands of
a third table. The red place stands first, then the green one and then the blue one.

A picture of thirty two places a colour stands of an alpha of a fourth table of the places of a code, of a
difference of its own where that place stands at minus three, and of a full place everywhere else.

## The tables

The tables of the walk stand in `packages/formats/src/scrplayer/img-tables.ts`, read out of the reference on
their own: the four resources of `ArcFormats/ScrPlayer/` (two places a byte, the count of the places of a
code and its own) and the tables the source of `ImageIMG.cs` and of `ImageI.cs` carry. The test of the walk
holds the four resources to the word of the files they were read of.

## Deviations

* A code whose places stand past the window of the walk is turned away, where the reference would read past
  the places of its own window.
* The places of the picture stand of the places of the walk and of a row of nothing behind them, which the
  reference builds of its own and never turns out; a port that turned them out of the places of the picture
  alone stands of the same picture.
* A picture of the kind of twenty four places a colour stands of four places a place in the walk of the
  reference, of a place of nothing for the alpha of it; this port hands a bitmap of the three places of a
  colour of it over, of a full alpha of the place behind them.

## Tests

`tests/formats/scrplayer-img-image.test.ts` holds the four resources of the walk to the word of the files
they were read of, and writes the streams of two pictures off the tables of the reference on their own: the
codes of a place of the walk stand of a pair of the place of it and of the count of its places, so the
places of the code behind a code stand of the places the one in front of it left free, and the fixture
searches the codes of every place of it.

The head, the two kinds of the picture, the mark, a row wider than the window of the walk and a file that
stands short of its head are pinned. The walk is pinned of a picture of two places of three places a colour:
the first place of three differences, of the places three, four and five of the table of the places of a
difference, which stands of the places of the picture, and the second one of a code that names no difference
at all, over places of nothing. A picture of four places a colour is pinned of the alpha of it, which stands
of the whole place of a picture less two. The bitmap of the format is read back beside them.
