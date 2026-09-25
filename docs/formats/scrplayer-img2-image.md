# ScrPlayer second picture (`IMG2`)

Format reference: GARbro `ArcFormats/ScrPlayer/ImageI.cs` (`Img2Format`, `Img2Reader`, `Img2BitStream`),
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

The second picture of the ScrPlayer engine stands of the walk of the first one
(`docs/formats/scrplayer-img-image.md`): the stream stands of codes whose count of places and whose own
place stand in a table of `ArcFormats/ScrPlayer/`, the walk peeks the window of a table and stands of the
entry the window names, of the count of the places of the entry alone, and the places of the picture reach
back to the row of the walk, to the row in front of it or to the one in front of that. The two pictures
stand of the table of the places a code reaches back to as well, which carries the place it read to one
place in front of itself.

## Head

| place | field |
| --- | --- |
| 0 | the mark `IMG2` |
| 0x0C | the width and the height of the picture (`u16` each) |
| 0x10 | the places of a colour of it (`u16`): twenty four or thirty two |
| 0x20 | the places of the walk |

## What stands apart from the first picture of the engine

* The places of a byte of the stream are read from the **lowest place of it up**, where the first picture
  reads them from the highest one down, of a table of the places of a byte of its own. The walk of this
  picture stands of no such table.
* The place of a code within a row stands of **six** places of the table of the places of a code, where the
  first picture stands of five of them.
* The table of the colours of a code names the places of a colour that stand of a **difference of their
  own** (`0xFD`), rather than the places that stand as they are, and the differences stand of tables of
  their own, of ten places of a code of the stream and of the second table behind a place of `0x41`.
* The picture of thirty two places a colour carries the alpha of a place in the table of the places of a
  code of its own, of nine places, of a place one within the row and of a flag of a difference of the alpha
  of its own: where that flag stands, the place of the picture stands of the whole alpha less a difference
  of the table of the alpha, and of the whole one everywhere else.

## The place of the tables of the codes

The tables of the codes of the places of the picture carry the places of a code up to `0xB8` alone: a code
of `0xD8` and above, which hands the places of the picture over as they stand, is therefore reached through
a code of `0xB8` and the eleven places of the second table behind it, and no other way. The tables of this
picture reach up to `0xB8` (184) and those of the second table up to `0x9C` (156), which the test of the
walk holds.

## The tables

The tables of the walk stand in `packages/formats/src/scrplayer/i-tables.ts`, read out of the reference on
their own: the five resources of `ArcFormats/ScrPlayer/` (`IControlTable1`, `IControlTable2`,
`IControlTable32`, `IColorBitsTable1` and `IColorBitsTable2`) and the tables the source of `ImageI.cs`
carries. The table of the places a code reaches back to is the one of `ImageIMG.cs` and stands in
`img-tables.ts`. The test of the walk holds the five resources to the word of the files they were read of.

## Deviations

* A code whose places stand past the places of the picture is turned away, where the reference would read
  past the places of its own output.
* A walk that stands past the places of the stream is turned away, where the reference throws from its own
  end of the stream.
* As for the first picture of the engine, a picture of the kind of twenty four places a colour stands of
  four places a place in the walk of the reference, of a place of nothing for the alpha of it; this port
  hands a bitmap of the three places of a colour of it over.

## Tests

`tests/formats/scrplayer-img2-image.test.ts` holds the five resources of the walk to the word of the files
they were read of, and writes the streams of four pictures off the tables of the reference on their own: the
fixture looks the code of every place up in the table of the codes and writes the places of the entry of it,
of a search over the codes of every place, so the places of the picture are the ones the fixture asks for.

The head and its refusals stand pinned beside the walk of the codes of a table, of a byte of the stream
read from the lowest place of it up, and of a walk that stands past its stream. The walk is pinned of a
picture of two places of three places a colour (three differences of the places three, four and five of the
table of the places of a difference, and then a place of a code that names no difference at all, of a row of
nothing), of a picture of four places a colour (the alpha of the place of it, of the whole alpha of the
picture less four places), of a code of three places of their own of the second table of the codes of the
picture, and of a place of a colour of the code of that second table (the places one, a difference and two
of the tables of the colours of a code). The bitmap of the format is read back beside them, of the two kinds
of the picture.
