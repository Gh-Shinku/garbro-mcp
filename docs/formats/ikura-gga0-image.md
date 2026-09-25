# IKURA GDL image (GG2)

* Reference: `ArcFormats/Ikura/ImageDRG.cs` (classes `Gga0Format` and its `GgaMetaData`), GARbro commit
  `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.
* Local id: `ikura-gga0-image`; tag `GG2`; extensions `.gg1`, `.gg2`, `.gg3`, `.gg0`.

## Head

The picture opens with the mark `GGA00000` of the places of the file (of the letters of the engine), then
the width and the height as two words, the places of a colour of a place of the picture, the places of the
file of the kind of the walk of it (the lowest place of them standing of the alpha of the picture), the
places of the file of the head of the picture and the places of the file of the walk of it. The walk of the
places of the picture stands behind the head of it, of the head of the picture of the places of the file of
the mark of the engine.

## The walk of the places of the picture

The places of a pixel of the picture stand of four places of the file. Every place of the walk stands of one
or two places of the file:

| the place of the walk | what the places behind it stand of |
| --- | --- |
| 0, 1 | a run of the places of the pixel before the place of the walk, of the count of the fields (of one place of the file, or of two of them) |
| 2, 3 | one place of the picture a count of pixels before it (of one place of the file, or of two of them) |
| 4, 5 | a run of the places of the picture a count of pixels before it (of the count of one place of the file and of two of them) |
| 6, 7 | a run of the places of the picture a count of pixels before it (of the count of two places of the file and of one of them) |
| 8 | the place of the pixel before the place of the walk |
| 9 | the place of the picture one row above it |
| 0x0A | the place of the picture one row above it and one pixel to the left of it |
| 0x0B | the place of the picture one row above it and one pixel to the right of it |
| 0x0C or more | a run of the places of the file themselves, of four places of the file to a place of the picture |

The places of a run of the walk stand of the places of the picture itself: the walk of the reference stands
of two places of the picture at a time, of the places of the file of a count of them behind the place of the
walk.

## What this port does not carry

* **A run of the walk standing of more places of the picture than the picture holds, or before the places of
  the picture of it, and a walk standing short of the file of the picture.** Each of them stands of
  `INVALID_ARCHIVE` here; the reference stands of the places of the picture beyond the places of it (of
  `IndexOutOfRangeException`) and of `InvalidFormatException` where the places of the file of the walk stand
  short of the file.
* **The places of the file the head of the picture names of the kinds of the walk of it.** The reference
  stands of the places of the file of the alpha of the picture where the lowest place of the kind of the walk
  of it stands of one (`PixelFormats.Bgra32`) and of no places of an alpha of it where it stands of nought
  (`PixelFormats.Bgr32`); the places of the file of the walk stand of four places of a pixel of the picture
  of the engine itself in either case, so this port hands over the places of the file of the picture of the
  walk of it as they stand, and records the places of the file of the kind of it in the entry of it.
* **Packing a picture.** `Gga0Format.Write` stands of no walk of it in the reference.

The count of the places of the file of the walk itself stands of the places of the file of the picture
of `0x100` of them or above: a picture of the places of the file of 69 and 1 of them stands of the
count of the places of the file of the walk of the engine of `0x50` of them (`276` places of the file of
the picture, of more than `0x100` of them).

## How the walk stands verified

Four pictures of our own stand of the walk of the engine: the head of the picture, a picture of the places
of the file themselves and of the places of the picture before the place of the run, a picture of the places
of the picture of the row above the place of the walk (of the places of the file of the runs of the picture
one row above it and one pixel to either side of it), and a walk standing short of the file of the picture.
