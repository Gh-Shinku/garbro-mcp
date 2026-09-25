# Majiro game engine RGB image (RCT)

* Reference: `ArcFormats/Majiro/ImageRCT.cs` (classes `RctFormat`, its `Reader` and `RctMetaData`), GARbro
  commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.
* Local id: `majiro-rct-image`; tag `RCT`; extension `.rct`.

## Head

The picture opens with the mark `0x9A925A98` as a word of the file (the four places of the file, of the
lowest place of them first), then the letter `T`, then the letter of the walks of the picture (`C` of a
picture of the places of the file of its own and `S` of a picture standing of a key), then the number `0`,
then the number of the kind of the picture (0 or 1), then the places of the picture to either side and up
and down as two words, and then the places of the file of the walk of the picture. A picture of the second
kind stands of a word behind the head of it: the count of the places of the name of the picture beside it,
of which the walk of the places of the picture stands.

## The walk of the places of the picture

The walk of the places of the picture stands of runs of the places of the file, of the places of a pixel of
the picture (three places of the file to a place of the picture): the walk reads a run of the places of the
file themselves, and then a walk of the places of the picture where the places of the file behind it stand
of no count of their own.

* A run of the places of the file stands of a count of the places of the file behind it: of the count of the
  places of the file of the run itself, one taken off three of them (of a count of 1 to 3, of the four
  places of the file of the count taken off it), or of the word of the file behind the count where the count
  stands of the number `0x7F`.
* A run of the places of the picture stands of a count of the places of the file of the run itself (of 1 to
  3 of them, of the word of the file behind them where the count stands of 3 of them) and of the places of
  the picture of the run behind a count of the places of the file, of the table of the walk of the engine:
  of the places of a row of the picture of it and of the places of a pixel of it to either side, of the
  places of a row of the picture of the places of its width.

The places of the table of the walk stand of the places of the picture itself, of no places of the file: the
places of the run behind the count of the places of the file of the walk of it, of the places of the picture
of the run of the walk of the reference standing behind the places of the file of it. A run of the walk
standing of no places of the picture of the file of it, of the places of the file before the picture, stands
of `INVALID_ARCHIVE` here, as the reference stands of `InvalidFormatException` (of its own guard over the
places of the picture of the run).

## The places of the picture handed over

The reference hands the places of the picture over as `ImageData.Create` with the places of a colour of the
picture one behind the other (`Bgr24`), so the rows of the bitmap of it stand from the top of the picture
down, of the places of a pixel of the picture of three places of the file to a place of the picture.

## What this port does not carry

* **A picture of a key** (the letter `S` of the head of it). The key of such a picture stands of a password
  the reference asks the user for, or of the key of the archive of the engine beside it (`FindImageKey`,
  standing of the archive of the Majiro engine and of the pictures of the places of the file of it): no
  places of the file of the picture itself stand of the key of it, so the port stands of
  `UNSUPPORTED_FEATURE`. The head of such a picture stands readable all the same.
* **The places of the picture of the file of it standing of the places of a picture beside it.** The
  reference stands of the picture beside it (`ReadBaseImage`, of the name of the picture of the second
  kind), of the places of the file of the picture of the walk of it, where the setting `OverlayFrames`
  stands of it; this port stands of the places of the file of the picture itself alone, of no picture
  beside it.
* **The places of the colours of a picture standing of the mask of the engine beside it** (`_.rc8` of the
  name of the picture, of the walk of the places of the file of it and of the alpha of it): standing of the
  file system of the project, of no places of the file of the picture itself. The port hands over the places
  of a colour of the picture alone.
* **Packing a picture.** The reference stands of a writer of its own (`RctFormat.Write`, of the walks of the
  places of the file and of the key of the engine); this port stands of the walk of the places of the file
  alone.

## Deviations of the walk of the places of the file

* The walk of the places of a run of the second kind standing of the places of the table of the engine
  beyond the places of the table stands of `INVALID_ARCHIVE` here; the reference reads the places of the
  table itself, of the places of the file of the walk of it beyond the table where the count of the places
  of the file of the run stands of the number behind the places of it.
* The places of the file of the walk of the picture standing short of the file of it, and a run of the walk
  standing past the places of the picture, stand of `INVALID_ARCHIVE` here; the reference reads the places
  of the file of it beyond the file (of noughts) and stands of the places of the picture of the run of its
  own guard.

## How the walk stands verified

Nine pictures of our own stand of the walk of the engine: the head of the picture (of the mark of it, of the
letters of the walks of it, of the numbers of the kind of it and of the word of the count of the places of
the name beside it), a picture of one place of the file, a picture standing of the places of a pixel of the
picture before the place of it, a picture standing of a run of the second kind of four places of the pixel
before it, a picture standing of a run of the table of the walk of the engine five places behind it (of the
first pixel of the picture), a picture of the second kind (of the places of the file of the head of it), a
picture of a key (standing of `UNSUPPORTED_FEATURE`), a picture of a walk standing past the places of the
picture and one standing behind the file of it, and the marks of the head of the picture.
