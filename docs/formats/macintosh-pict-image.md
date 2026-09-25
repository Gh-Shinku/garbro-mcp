# Apple Macintosh image (PICT/MAC)

* Reference: `ArcFormats/Macintosh/ImagePICT.cs` (classes `PictFormat`, `PictReader`, `Pixmap` and the
  `BinaryStreamExtension` beside them), GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`,
  MIT License.
* Local id: `macintosh-pict-image`; tag `PICT/MAC`; extensions `.pct`, `.pict`, `.pic`.

## Head

The head of a picture stands at the place 0x200 of the file, or at the place four of it where the file
opens with the mark `PICT` (the four places of the file, of the lowest place of them first, as the engine
reads its marks). The words behind the mark stand of the places of the picture the other way around from the
places of the file of the other engines of this project: the places of the head of the picture to the top,
to the left, to the bottom and to the right, the word of the walk of the picture (`0x11`) and the word of
the kind of the picture (`0x2FF`). The width and the height of the picture stand of the places of the two
last words of it, one taken off the other.

The reference registers the mark `PICT` and the head standing of no mark at all as its signatures; this port
registers the mark alone and stands of the extensions of the engine for the rest.

## The words of the walk of the picture

The walk of the places of the picture opens at the place behind the head of it, and reads the words of the
file of it one behind the other. The words of the walk of the picture stand of an even count of places of
the file: where the place of a word stands of an odd count of them, the walk stands one place of the file
behind it before it reads the word.

| the word of the walk | what it names |
| --- | --- |
| `0x0000` | no places of the file at all |
| `0x0001` | the clip of the picture: a count of the places of the file behind it, of which the walk stands of the two first of them |
| `0x001E` | the mark of the places of the picture standing of a place of a colour of the medium |
| `0x0090`, `0x0091`, `0x0098`, `0x0099` | the places of the picture, of a row of it standing of the places of the file of their own |
| `0x009A`, `0x009B` | the places of the picture, of the places of a colour of a place of it standing of the file |
| `0x00A1` | a comment of the picture: the kind of it, then a count of the places of the file behind it |
| `0x0C00` | the head of the picture itself: the places of the file behind it stand of no walk here |
| `0x00FF`, `0xFFFF` | the end of the walk of the picture |
| any other word | no word of the engine: the port stands it of `UNSUPPORTED_FEATURE`, as the reference stands of `NotSupportedException` |

The words `0x0090` to `0x009B` stand of the places of the picture itself: of the rectangle of them (the
places of the head of the picture to the top, to the left, to the bottom and to the right), which stand of
the width and the height of the picture the walk hands over, of the places of a colour of a place of it, of
the source and the destination rectangles and of the kind of the walk of the places of the file of it.

The word of the places of a row of the picture stands of the places of the file themselves where the
picture stands of the words `0x0090` to `0x0099` (the two first of them stand of the word of the places of
a row of it, and the two behind them of six places of the file of the head of the places of a colour of the
picture), and of the places of the head of the places of a colour of it where it stands of the words `0x009A`
and `0x009B`.

## The places of a colour of a place of the picture

The places of the head of the places of a colour of a picture of the words `0x009A` and `0x009B`, and of the
pictures of the words behind them whose word of the places of a row stands of the highest of its places,
stand of the words of a picture of the engine: the kind of the places of the file, the kind of the walk of
them, the places of the walk, the places of a place of the picture to either side and up and down, the kind
of a place of a colour, the places of a colour of a place of it (of 1 to 32 of them), the count of the
places of a colour of a place of it (of 1 to 4), the places of a colour of a place of it, the places of the
places of a colour of one and the places of the table of the colours of the picture.

A picture of eight places of a colour to a place of the file stands of a table of the colours of its own
where the words of the table stand behind the head of the places of a colour of it: the places of the file of
a colour stand of three words of it, one taken off the other, of `0x101` places of the file to a place of
the colour; the word in front of them names the place of the colour of the table the colour stands at (of
none of the places of the table where the word of the head of the table stands of the highest of its
places). Where the table stands of a colour of the picture behind it, the places of the colours of it stand
of the places of the file of the table taken the other way around (the child of the walk of the reference
takes them off the white of the colours of a place of the picture).

## The places of a row of the picture

A row of the places of the picture stands of a count of the places of the file behind it and then of the
places themselves, of the walk of the places of a row of the engine (of the walk `PackBits` of the engine of
the place of the picture): a place standing lowest of its word (`< 0x80`) stands of a count of the places of
the file behind it, one place of the file to a place of a colour of the picture behind it; a place standing
highest of its word stands of a count of the places of the file of the place behind it taken the other way
around (of `257 - word` of them), which the walk stands of again and again.

The places of a row of the file of a picture stand of the places of the width of the picture, of the places
of a colour of it one behind the other: of one place of the file to a place of the picture of a picture of
sixteen places of a colour to a place of it (of the places of the file of it the other way around from the
places of the walk of it), of the places of the width of the picture of a picture of thirty two places of a
colour to a place of it (of four places of the file to a place of the picture where the picture stands of an
alpha of its own, and of three of them where it does not), and of the places of the **width of the picture
alone** of a picture of twenty four places of a colour to a place of it. That last one stands of the walk of
the reference itself: the places of the file of the walk of the reference stand of the places of the width
of the picture, of no places of a colour of it, so a row of twenty four places of a colour of a place of the
picture stands of a count of the places of the file of the width of the picture, and the places of a colour
of it behind the first of them stand of the places of the picture behind the places of the file of it.

Where the count of the places of a row of the picture stands of no places of the file at all, the places of
the file of the row stand one behind the other, of no walk of them: of a count of the places of the file of
the width of the picture to a row.

## The places of the picture handed over

The reference hands the places of the picture over as `ImageData.Create`, so the rows of the bitmap of it
stand from the top of the picture down, of the kind of the places of a colour of the picture: `Bgra32` (of
four places of a colour to a place of it), `Bgr32`, `Bgr24` (of the places of the file of a colour of a
place of the picture taken apart from one another), `Bgr555`, `Indexed8` (of the table of the colours of the
picture) and `Gray8`.

## What this port does not carry

* **The places of the file of our own beyond the file of the picture, the words of the walk of the picture
  standing of no places of it, or the places of a row standing of no places of the file of it.** Each of them
  ends as `INVALID_ARCHIVE`; the reference reads the places of the file behind the walk of the picture as
  noughts and stands of the words of its own beyond the picture.
* **A picture of the places of the file of it of one place of a colour to a place of the picture.** The walk
  of a picture of the words `0x0090` to `0x0099` of no table of the colours of its own stands of the walk of
  one place of a colour to a place of the picture, which the walk of the places of the file of the engine
  names and then turns away (`NotSupportedException`, and `UNSUPPORTED_FEATURE` here): the reference cannot
  read a picture of one place of a colour to a place of the picture either.
* **A table of the colours of a picture of more than 0x100 places of it.** The table of the BMP of the
  picture stands of 0x100 places of a colour at the most; the reference names the places of the colours of
  the picture itself, of as many of them as the head of the picture names.
* **A picture of the places of a colour of a place of it of no walk of the engine** (of four places of the
  file to a place of the picture, or of more than thirty two of them): `UNSUPPORTED_FEATURE`, as the
  reference stands of `NotSupportedException`.
* **A picture of the places of a file of a colour of the walk of the reference standing of a picture behind
  it.** The walk of the reference stands of the last picture of the file, as its own note names it: this
  port stands of the same picture, of no places of the pictures behind it.
* **Packing a picture.** `PictFormat.Write` stands of no walk of it in the reference.

## Deviations of the walk of the places of the file

* The places of the scanline of a row of the picture stand of a walk of their own in the port, of the places
  of the picture itself in the reference: a picture of a wider walk of the places of the file behind it
  allows a longer scanline of a picture behind it there, and no scanline of more places than the picture
  itself holds here.
* The places of a colour of a place of the picture of a picture of no table of its own stand of the walk of
  the words of the reference as they stand there, of no guard for a picture of more places of the colours
  than the table of it holds.

## How the walk stands verified

Ten pictures of our own stand of the walk of the engine: the head of the picture of the mark `PICT` and of
the places 0x200 of the file, the words of the walk of the picture (the clip, the comment, the head of the
places of the file of it, of an odd count of places of the file, of the places of the file behind them, the
end of the walk of it), a picture of eight places of a colour to a place of it of a table of two colours of
its own (of a row standing of two runs of the places of the file, one of them of the places of the file
themselves and the other of one place of the file of the row behind it), the places of a picture of thirty
two places of a colour to a place of it (of no walk of the row of it, of the places of the file of it one
behind the other), the alpha of a picture of four places of a colour to a place of it, the places of a
picture of sixteen places of a colour to a place of it, the places of a picture of twenty four places of a
colour to a place of it, the walk of a picture of the places of a colour of no walk of the engine, the walk
of a picture of a word of no walk of the engine, and the marks of the head of the picture.
