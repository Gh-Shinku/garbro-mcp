# Circus image (CRX)

* Reference: `ArcFormats/Circus/ImageCRX.cs` (classes `CrxFormat` and the `Reader` beside it), GARbro commit
  `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.
* Local id: `circus-crx-image`; tag `CRX`; extension `.crx`.

## Head

The picture opens with the word `CRXG` and a head of its own behind it:

| at | what stands there |
| --- | --- |
| 4, 6 | where the picture stands to the left and above, of their own signs |
| 8, 0xa | the places of the picture |
| 0xc | the kind of walks the places stand of: 1, 2 or 3 |
| 0xe | the places of the picture standing of their own |
| 0x10 | the places of a place of the picture: nothing, one, or the colours of a colour map |
| 0x12 | the kind of the picture |

The places of a place of the picture stand of the third place of the head: nothing means three places to a
pixel, one means four, and any other place the colours of a colour map which stands behind the head, of eight
places to a pixel.

A colour map stands of as many colours as the head names, of three places to a colour - or of four where the
head names more than a picture of eight places to a pixel holds, in which case as many colours as such a
picture holds stand of four places to a colour. A colour of a map standing of a colour of its own (every
place of red and blue and no green) stands of every place of it, as the reference reads it.

## The walks

The places of the picture stand of words of their own, of the kind the head names:

* kind 1 stands of a window of 64K places the walks stand over: a control place names, of every eight places,
  whether a place stands as it stands or a run of the places behind it stands, and a run stands of the places
  of the window itself, so a run reaching over the places it has written repeats them. A run stands of a
  control place of its own: the four highest places of it name a run of four places to a piece and a place
  behind them, or a run of two to four places over a place of the window, or - where the control place stands
  of 0x7f - of a count and a place of their own, or a run of four places and more.
* kinds 2 and 3 stand of the walks of a word of the places of their own (a stream of the kind the engine
  packs with zlib), behind a head the kind 3 stands of: a count of the walks and as many tables of sixteen
  places as it names, and - where the places of the picture stand of their own - a word of their length.

A picture of three or four places to a pixel stands of a place of a control of its own for every row: the
places of the row stand of the places before them, of the places above them, of the places above and to the
left of them, of the places above and to the right of them (read from the left of the row), or - every colour
of the row of runs of its own, of a place and of as many places of the place behind it as stand of it. A row
of a kind the picture does not name stands of nothing at all.

## The places of a colour of a picture of four places to a place

A picture of four places to a place stands of the places of its alpha first, and of the three colours behind
them the other way round: the port stands them about, and the alpha stands of the places of the kind of the
picture (the places of the alpha standing as they stand, or of every place of them). A picture whose kind
names the places as they stand stands of them as they stand.

## Deviations

* Every read is bounded: a picture whose walks stand short of the file, and a picture whose places stand
  short of the places it names, are turned away.
* A run of a colour standing of more places than the row of the picture holds stops at the end of the row;
  the reference walks past the end of the places of its own.
* The places of the picture stand of the places of the bitmap of it, of the places of a place of the picture,
  the places of a row of a picture of fewer than 24 places standing of nothing behind them.

## Verification

Seven tests over synthetic fixtures (`tests/formats/circus-crx-image.test.ts`): the head of a picture and the
ones it turns away, of the places of a place of it and of the kind of its walks; the colour map of a picture,
of four places to a colour and of the places of a colour of its own; the walks of the engine, of the window
behind them and of a run standing over the places it has written; the walks of a word of the places of their
own, of the places before them, of the places above them, of the places above and to the left of them, and of
the places above and to the right of them; a row standing of runs of every colour of it; the places of a
colour of a picture of four places to a place, of the kinds of its alpha; and the word the format tells a
picture by.

The walks of a kind standing of a run of four places to a piece of a control place (the three kinds of a run
of the first kind the fixtures do not name), the head of a picture of the third kind, the word of the length
of the places standing of their own, and a picture of eight places to a pixel standing of the walks of a word
of the places of its own stand in the port as they stand in the reference but no fixture of them was finished;
they stand among the places still to be verified of the record of this format, together with the differential
against the reference on real files.
