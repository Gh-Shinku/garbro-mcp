# Lucifen Easy Game System image (ELG)

* Reference: `ArcFormats/Lucifen/ImageELG.cs` (classes `ElgFormat`, `ElgMetaData` and the `Reader` beside
  them), GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.
* Local id: `lucifen-elg-image`; tag `ELG`; extension `.elg`.

## Head

The picture opens with the letters `ELG` and the place of the kind of the walk of it, of which the
reference registers five heads as its signatures: the places of a colour of a place of the picture itself
(8, 24 and 32) and the two kinds of the pictures beside them (2 and 1).

| the place of the kind | the head of the picture |
| --- | --- |
| 8, 24, 32 | the places of a colour of a place of the picture, then the width and the height |
| 1 | the places of a colour of a place of the picture, the places of the picture to either side and up and down, then the width and the height |
| 2 | the places of a colour of a place of the picture, the width and the height, the places of the picture to either side and up and down, then the chunks of the file of the picture |

The walk of the places of the picture stands at 0x8 of a picture of the first kind and at 0xD of the two
kinds beside it.

## The walk of the places of the picture

A picture of the third kind stands of chunks of the file of the picture before the walk of the places of it:
every chunk stands of a place of the file standing of one, of the places of the file of the chunk and of the
places of the chunk itself, of which the walk of the engine stands of four places of the file of the count
of the chunk. The walk of the places of the picture stands behind them.

The walk of the places of the picture stands of places of the file, of the places of a colour of a place of
the picture: a place of the file standing lowest of its places (`< 0x40`) stands of a run of the places of
the file themselves, a place of the file behind it stands of a run of one place of the colour of the
picture, and the places of the file above them stand of the places of the picture before the place of the
walk of it.

| the places of the file | the places of the picture of the run |
| --- | --- |
| `00xxxxxx` | the places of the file of the run themselves: of the count of the places of the file behind the count of the run (of 1 to 0x20 of them, or of 33 of them and the count of the places of the file behind the count) |
| `01xxxxxx` | one place of a colour of the picture, of the count of the run before it (of 3 to 0x22 of them, or of 35 of them and the count behind it) |
| `10xx0000` | the places of the picture of the run a count of places of it before the place of the walk (of the count of the run of the places of the file behind the count, of 2 of them) |
| `10xx0001` | the places of the picture of the run a count of them before it, of the count of the places of the file behind the place of the walk (of 3 of them and the count behind it) |
| `10xx0010` | the places of the picture of the run a count of them before it (of the word behind the count of the run, of the places of the file of the count) |
| `10xx0110` | the places of the picture of the run two places of the file behind the count of it before the place of the walk (of the places of the file of the count) |
| `1100xxxx` | the places of the picture of a row of the picture above the place of the walk, of the count of the run of the places of the file behind the count, of no places of a pixel to either side of it |
| `1101xxxx` | the places of the picture of the row of the picture **one** place above the place of the walk and of the place of the pixel **one to the left** of it |
| `1110xxxx` | the places of the picture of the row of the picture one place above the place of the walk and of the place **one to the right** of it |
| `1111xxxx` | the places of the picture of the run a count of them before the place of the walk, of the places of the file of the count of the run |

The walk of the places of a picture of eight places of a colour and the walk of the places of the alpha of a
picture of thirty two of them stand of the places of the file of the count behind the count of a run
themselves, and of no places of the rows of the picture: the places of the file above the places of the
picture stand of no count of their own there, of a count of 1 or 2 places of the picture only. The walk of
the alpha stands of the places of a colour of the picture, of the fourth place of a place of it, and of the
places of the file of the count of a run the count behind it.

The table of the colours of a picture of eight places of a colour to a place of the picture stands of the
walk of the places of the file of its own before the walk of the places of the picture: of 0x400 places of
the file, of four places of them to a place of a colour of the picture (blue, green, red and no place of an
alpha of it).

The walk of the places of a picture stands of the places of an alpha of its own, of a place of the file
standing of `0xff` at the end of a walk: the walk of the engine reads the place of the file of the walk of
a picture before it looks at the places of the picture of it, so a walk of the file of a picture stands of
the place of the file of its end.

## What this port does not carry

* **A run of the walk standing of more places of the picture than the picture holds, and a walk standing
  short of the file.** Both stand of `INVALID_ARCHIVE` here; the reference stands of the places of the
  picture beyond the places of it (of `IndexOutOfRangeException`) and reads the places of the file behind
  the file of the picture as noughts.
* **Packing a picture.** `ElgFormat.Write` stands of no walk of it in the reference.

The count of the places of the file of the walk of the engine of the two places of the file of the
picture of it stands of the places of the file of it of `0x20` of them or above: a picture of the places
of the file of 40 and 1 of them of the walk of the eight places of a colour of the engine (and of the
twenty four of them) stands of the places of the file of the count of the walk of the engine of the word
behind the count of it (`0x20`, `0x07` of the places of the file of the walk of the engine of the
`40` places of the file of the picture of the engine) and of the places of the file of the picture of
them behind it. The walk of the places of the file of this port stood of the places of the file of the
count of the walk of the engine *every* place of the picture of the engine of them; the reference
stands of the places of the file of the count of it alone (of the places of the file of the engines of
the third and fourth kinds of the walk of it).

## How the walk stands verified

Eight pictures of our own stand of the walk of the engine: the head of the three kinds of the picture (of
the places of a colour of a place of it and of the places of the picture to either side and up and down), a
picture of eight places of a colour to a place of it (of the table of the colours of it of 0x400 places of
the file, of a run of the places of the file themselves and of a run of one place of a colour), the places
of the picture of a row of it above them (of 24 places of a colour to a place of the picture), the alpha of
a picture (of 32 places of a colour to a place of it), a picture of the second kind, a picture of the third
kind (of a chunk of the file of the picture), a walk standing short of the file of the picture, and the
marks of the head of the picture.

The walk of the places of the picture of a row of it above them caught a walk of this port standing of the
places of the file of the kind of the run behind the count at 0x10: the port stood of the places of the row
of the picture of the third kind of the run there, of the places of the picture one place to the right of
the place of the walk, which the places of the picture of a picture of two places to a row stand of.
