# FFA System PT1 picture (`PT1`)

Format reference: GARbro `ArcFormats/Ffa/ImagePT1.cs` (`Pt1Format`, `Reader`), GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## Head

The file starts with the kind of the picture (`i32`, 0 to 3), then the word `-1` (`i32`), the box of the
picture, the width and the height (`i32`, `u32` and `u32`) and two counts (`i32`):

| offset | field |
| --- | --- |
| 0 | the kind of the picture: 0, 1, 2 or 3 |
| 4 | `-1`, which every picture of the engine carries |
| 8 | the place of the picture within a picture of the game (the left one, then the top one) |
| 16 | the width and the height of the picture (`u32` each) |
| 24 | the count of the packed places of the walk |
| 28 | the count of the places it turns out, which must be three times the width and the height |

The picture is twenty four bits a place, and thirty two for the kind of three, whose alpha stands in a walk
of its own behind the walk of the colours. The packed stream begins at `0x20`.

## The frame of the walk

The places of a picture of the kinds of 0 and 1 stand of an LZSS walk over a **frame of 0x1000 places that
the walk fills itself**, and the frame is the same for every picture of those kinds:

* thirteen places of every place of a byte, from zero up (`0x0D00` places);
* the places of a byte from zero up and then from the highest one down (`0x100` each);
* a hundred and twenty eight places of nothing, a hundred and ten of a space and eighteen more of nothing.

The last eighteen places are where the ring of the walk starts, at `0xFEE`.

## The walk

The stream is read a flag byte at a time, and the eight places of a flag are its steps, the lowest one
first:

* a set place writes a place of its own, which stands in the byte behind the flag;
* a clear place writes a **run**: its place stands in the byte behind the flag and the low half of the byte
  behind that one, with the high half of the second byte joining it four places up, and its count is the
  low half of the second byte plus three.

Every place the walk writes is written into the frame as well, at a place that runs on from `0xFEE` and
turns over at the end of the frame, which is what lets a run reach the places it has written itself. The
kind of 0 writes **one** place of the picture for every place of the walk and the kind of 1 **three** of
them, so the two kinds part in that single place, and a stream of the kind of 1 names three times fewer
places than the picture holds.

The walk stops as soon as the places of the picture stand full, which is what the reference does as well.

## Deviations

* The kinds of 2 and 3 stand of a walk of their own (a predictor over the places of the row above, with an
  escape to a run) which this port does not carry **yet**: a picture of either of them is detected, listed
  and refused at extraction rather than skipped, since the head and the box of it are the same.
* A file whose packed places run past the end of it, or whose count of packed places stands at nothing, is
  turned away as a broken picture, where the reference would read past the end of its own stream.
* The count of the places of the walk stands in the head, but the walk of the reference does not stand on
  it: it ends of the places of the picture alone, so this port does the same.

## Tests

`tests/formats/ffa-pt1-image.test.ts` writes the head of the reference and the stream of the walk by hand,
and pins the frame of the walk as well: its thirteen places of a byte at the start, the places of a byte
from zero up and then from the highest one down, the places of nothing and of a space behind them and the
eighteen the ring starts in.

The places of a picture of the kind of 0 are a place of its own and two runs whose places reach the frame
(which stands at thirteen of every place of a byte, so the start of it is the places of nothing), and the
same stream read as the kind of 1 turns every place of the walk into three of the picture: both are values
the fixture asks for rather than a recording of what the walk did. The head, the bitmap the format hands
over, the refusal of the kinds of 2 and 3 at extraction and the turning away of a kind this engine has none
of, of a word that is not `-1`, of a count of places that stands of another picture and of a file that ends
before its packed places are pinned beside them.
