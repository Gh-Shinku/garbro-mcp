# Digital Romance System image (DRG)

* Reference: `ArcFormats/Ikura/ImageDRG.cs` (classes `DrgFormat` and `DgdMetaData`), GARbro commit
  `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.
* Local id: `ikura-drg-image`; tag `DRG`; extensions `.drg`, `.ggd`, `.dgd`.

## Head

The picture opens with the mark of the file as a word of the file (the four places of the file, of the
lowest place of them first): `FULL`, `TRUE` (of twenty four places of a colour to a place of the picture)
and `HIGH` (of sixteen of them). The reference holds those three as the words `~FULL`, `~TRUE` and `~HIGH`
of the places of the file, so the places of the file stand of the places of the mark the other way around.
The width and the height stand behind the mark as two words, and the walk of the places of the picture
stands at the place 8 of the file.

## The walk of the places of the picture

The places of a pixel of the picture stand of three places of the file. The walk of the places of the file
stands of the places of the picture itself: every place of the walk stands of six places of the file, and a
place of the file standing of five or more of them stands of a run of the places of the file themselves.

| the place of the walk | what the places behind it stand of |
| --- | --- |
| 0 | a run of the places of the pixel before the place of the walk, of the count of the fields (of three places of the file to a place of the picture) |
| 1 | a run of the places of the picture a count of pixels before the place of the walk |
| 2 | a run of the places of the picture a count of pixels before it, of the word of the file behind the count |
| 3 | one place of the pixel before the place of the walk |
| 4 | one place of the picture a count of pixels before it, of the word of the file behind the count |
| 5 or more | a run of the places of the file themselves, of three places of the file to a place of the picture |

The places of a row of the picture stand of the places of the file, of the places of the row of their own,
of a count of the places of the file of four of them to a row of the picture: this port hands the places of
the row over to the bitmap of the picture, of the places of the file of the row behind them.

## What this port does not carry

* **A run of the walk standing of more places of the picture than the picture holds, or before the places of
  the picture of it, and a walk standing short of the file.** Each of them stands of `INVALID_ARCHIVE` here;
  the reference stands of `null` and of `InvalidFormatException` where its own guards stand, and reads the
  places of the file behind the file of the picture of the walk of it.
* **Packing a picture.** The reference stands of a writer of its own (`DrgFormat.Write`); this port stands
  of the walk of the places of the file alone.

## How the walk stands verified

Four pictures of our own stand of the walk of the engine: the head of the three marks of it (of the places
of a colour of a place of the picture), a picture of the places of the file themselves and of the places of
the picture before the place of the run (of twenty four places of a colour to a place of it), a walk standing
of the places of the picture before the first place of it (of `INVALID_ARCHIVE`), and the marks of the head
of the picture.
