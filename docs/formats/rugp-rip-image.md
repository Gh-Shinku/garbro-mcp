# rUGP compressed picture (`RIP`)

Format reference: GARbro `ArcFormats/rUGP/ImageRIP.cs` (`RipFormat`, `CRip` and `CRip007`), over the walk of
the head of an object of the engine (`CRioArchive.LoadRioTypeCore`), GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

The picture is a whole file of its own, of the mark of an **object** of the engine (`0x29F6CBA4`), and the
walk of the head of that object names the class behind it: `CRip` or `CRip007`. Every other class is turned
away. The extensions of the format are `rip` and `sia`, and the walk of `sia` is the one of the class `CRip`
of the kind 1.

## The head of the class `CRip`

| place (of the object) | field |
| --- | --- |
| 0 | the version of the class (`i32`) |
| 4, 6 | the places of the picture within its own place (`u16`) |
| 8, 0x0A | the first pair of the counts of the picture (`u16`) |
| 0x0C, 0x0E | the second pair of the counts (`u16`) |
| 0x10 | the flags of the walk (`i32`) |
| 0x14 | the count of the places of the run (`i32`) |
| 0x18 | a count the reference reads and stands of none (`i32`) |
| 0x1C | the run itself |

The places of the picture stand of the kind of the walk: of the second pair of the counts where the kind is 3,
and of the first where it is not. The kind is `flags & 0xFF` and stands of one to three; the kind of the walk
of the bits behind it is `(flags >> 16) & 0xFF`.

## The walks of the kind

| `flags & 0xFF` | walk | places |
| --- | --- | --- |
| 1 | `UncompressSia` | a picture of eight places of a grey: a count of the places of one colour, and then the colour of the run behind that count |
| 2 | `UncompressRgb1` (kind 1), `UncompressRgb2` (kind 2), `UncompressRgb3` (kind 3) | a walk over the **bits** of the run, of a place of a colour of the engine |
| 3 | `UncompressRgba` (kind 2) | a picture of a colour and of a place of an alpha, of the runs of the alpha |

The walk of a place of a colour of the engine stands of three tables of its own: `ReadLong` (the places of a
blue and of a red), `ReadShort` (the places of a green) and `ReadABits` (the places of the alpha of the kind
3), every one of them of the place of the colour of the picture in front of it. The walks of the bits fill the
places of the picture of the **last row of it up**, which is the turn of the walk of the engine rather than a
picture of the other way: the places of a row stand of the places of that row, and the picture is handed out
of the top of it down. The colour in front of the walk of a row is the colour the row behind it left behind,
so the second row of a picture stands of the deltas to that colour rather than of its own places.

## The head of the class `CRip007`

| place (of the object) | field |
| --- | --- |
| 0 | the version of the class (`i32`) |
| 4, 6 | the counts of the picture of it (`u16`) |
| 8, 0x0A | the places of the picture within its own place (`u16`) |
| 0x0C, 0x0E | the counts of the places of the walk of it (`u16`) |
| 0x10 | the flags of the walk (`i32`) |
| 0x14 | seven places of the walk of the places of the colour: the table of the places of a colour, three places of its own, and the counts of the places of a blue, of a green and of a red |
| 0x1B | the count of the run (`i32`) |
| 0x1F | a count the reference reads and stands of none (`i32`) |
| 0x23 | the run itself |

The reference reads the places of the walk of the class of the mark of the class behind the counts of the walk
where the schema of the object of it reads two and up; this port turns such an object away rather than
guessing at that mark.

The places of the walk of a place of a colour of the class (`UncompressRgb`) stand of the tables of the walk
of it (`tblQuantTransfer`), of the counts of the places of a blue, of a green and of a red above. Every place
of a colour of the walk stands of the place of the colour of the picture of the row **behind** the row of it,
where the places of the walk of the places of an alpha of the class (`UncompressRgba`) stand of the places of
the walk of it and of a picture of the counts of the walk.

## Deviations

* One place of the reference stands as `NotImplementedException` and is refused here as well rather than
  guessed at: the kind 2 of the bit walks of the class `CRip` (`UncompressRgb2`).
* The walk of the places of a colour of the class `CRip007` reads the place of the colour of the picture
  behind the row of it even of the **first** row, which stands before the places of the picture in the
  reference; this port stands of a colour of nothing there rather than reading past the picture.
* The walk of the places of an alpha of the class `CRip007` stands of the counts of the places of the walk of
  it and of a picture of the counts of the picture, so a picture of the two counts of a place of the walk that
  stands outside it is not a picture the reference can hand out; this port holds every place of the walk
  within the picture of the class.
* A file of no mark of an object, of another class, of a count of the places of the picture of nothing, of a
  kind of no walk at all, and of a run that stands past the places of the file, is turned away.
* The walks of the bits of the reference read of a stream that ends of its places without a word of its own;
  this port names a stream that ends within the places of a picture, and holds the places of a run to the
  places a row can hold, so a run that stands short of the picture is turned away rather than read past.

## Tests

`tests/formats/rugp-rip-image.test.ts` builds a picture of a run of places of a grey (of the two rows of the
counts of the run) and a picture of the walk of the bits of the kind 1, of the two rows of a colour of the
engine — the second row of which stands of the deltas to the colour of the first. Both are read back with the
reader of the project, so the counts, the palette of the grey and the places of the colours are held to the
fixture. A picture of the class `CRip007` of the places of a colour stands beside them, of the two rows of it
(the second row of which stands of the places of the row behind it rather than of a place of its own), and a
picture of the class of the places of an alpha: a place of an alpha of thirty one and a place of an alpha of
no change, of the counts of the repeat of the walk. A file of another mark, of another class, of a count of
the places of the picture of nothing, of a kind of no walk, and a picture of the walks of the kind 2, are
pinned beside them.
