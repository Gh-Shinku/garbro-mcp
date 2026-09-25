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

The picture is twenty four bits a place, and thirty two for the kind of three, whose **alpha** stands in a
walk of its own behind the walk of the colours: for that kind a count (`i32`) stands behind the packed
places of the colours and the places of the alpha walk behind it, as many of them as the picture holds
pixels. The packed stream begins at `0x20`.

## The frame of the walk of the two oldest kinds

The places of a picture of the kinds of 0 and 1 stand of an LZSS walk over a **frame of 0x1000 places that
the walk fills itself**, and the frame is the same for every picture of those kinds:

* thirteen places of every place of a byte, from zero up (`0x0D00` places);
* the places of a byte from zero up and then from the highest one down (`0x100` each);
* a hundred and twenty eight places of nothing, a hundred and ten of a space and eighteen more of nothing.

The last eighteen places are where the ring of the walk starts, at `0xFEE`.

## The walk of the two oldest kinds

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

## The walk of the two newer kinds

The stream of the kinds of 2 and 3 is a **bit stream** instead, read through a reservoir of thirty two
places that is refilled a whole number of bytes at a time:

```
cl = 32 - ch;  edx &= 0xFFFFFFFF >> cl;  edx += LE32(input, src) << ch;  src += cl >> 3;  ch += cl & 0xF8;
```

so the bits of a byte are read from its **lowest** place up, and a step that stops inside a byte leaves the
places behind it in the reservoir for the steps after it. The reservoir starts holding the three places of
the packed stream behind the first pixel of the picture, with the count of them, and the walk takes its
word at the fourth place of the stream and steps three places, so it reads on from the seventh place.

The first pixel of the picture stands in the stream as it is. Every place behind it is a pixel of three
places, and the walk tells each one of them of the lowest places of the reservoir:

* the places behind the first of a row stand of the pixel to their left, and the first place of every row
  behind the first row of the pixel above it. A set lowest place **repeats** that pixel; a clear one reads
  a second place, and a set one of those tells the pixel of a **difference** of its three colours;
* every other place of a row takes a first place of its own: a set one is the **gradient** of the left, the
  up-left and the up places with a difference of each colour; a clear one reads a second place, and a set
  one of those is the same gradient without a difference. A clear one of those reads two places more:
  **three** (the place to the left repeated), **two** (a literal pixel of the next twenty four places) or
  **one** (a difference of each colour from the place to the left). A clear one of those reads four places
  more: **0** repeats the up-left pixel, **8** the pixel above, and any other value is a difference of each
  colour from the pixel above, of the up-left pixel when the value is **4**.

A difference of a colour is a code of its own, read one code at a time from the lowest places of the
reservoir. Codes of three to fifteen places name the differences of minus one to minus twelve and of one
to twelve, and a pattern no code names is the escape of thirteen places that stands for minus thirteen:

| places | the difference | places | the difference |
| --- | --- | --- | --- |
| 1 | 0 | 9 | minus 7, 7, minus 8 |
| 3 | minus 1, 1 | 11 | 8, minus 9, 9 |
| 4 | minus 2, 2, minus 3 | 13 | minus 10, 10, minus 11 |
| 7 | 3, minus 4, 4, minus 5, 5, minus 6, 6 | 15 | 11, minus 12, 12, and minus 13 |

The kind of three joins the alpha walk of the picture of its first kind with the colours the walk of the
newer kinds turned out, a place of the alpha behind every pixel, and hands over a picture of thirty two
bits a place in the order of the places of the memory of the reference (`B`, `G`, `R`, alpha).

## Deviations

* A file whose packed places run past the end of it, whose count of packed places stands at nothing, or -
  for the kind of three - whose alpha stream is not there, is turned away as a broken picture, where the
  reference would read past the end of its own stream.
* The places behind the end of the packed stream are read as nothing, which is what the eight places the
  reference pads its own copy of the stream with stand for; the walk of the reference would read past the
  end of the file where this one reads a zero.
* The count of the places of the walk stands in the head, but neither walk of the reference stands on it:
  both end of the places of the picture alone, so this port does the same.
* A value of the four places of the third step of a place that is neither `0`, `4` nor `8` is walked like
  the `8` of the pixel above, which is what the reference does: it parts only those three.

## Tests

`tests/formats/ffa-pt1-image.test.ts` writes the head of the reference and the streams of the walks by
hand, and pins the frame of the walk of the two oldest kinds as well: its thirteen places of a byte at the
start, the places of a byte from zero up and then from the highest one down, the places of nothing and of a
space behind them and the eighteen the ring starts in.

The places of a picture of the kind of 0 are a place of its own and two runs whose places reach the frame
(which stands at thirteen of every place of a byte, so the start of it is the places of nothing), and the
same stream read as the kind of 1 turns every place of the walk into three of the picture: both are values
the fixture asks for rather than a recording of what the walk did.

The stream of the newer kinds is written from the lowest place of a byte up: a picture of two by two pixels
whose first pixel stands in the stream, whose second one is written like the one to its left, whose third
one like the place above it and whose last one is the gradient of the left, the up-left and the up places
with a difference of minus one for its first colour, so the places of the picture are known from the
stream. The bit pattern of **every** difference of the walk is pinned beside it - the twenty six codes, the
escape of the top count included - read off the ladder of the reference rather than off this port. The
alpha of the kind of three is pinned with the four places its own walk turns out, and the bitmap of the
format is read back for a picture of the kind of 0 and for one of the kind of three.

The head, the refusal of a kind this engine has none of, of a word that is not `-1`, of a count of places
that stands of another picture, of a file that ends before its packed places and of a picture of the kind
of three whose alpha stream is not there are all pinned as well.
