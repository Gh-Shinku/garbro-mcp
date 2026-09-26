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

## Deviations

* Three places of the reference stand as `NotImplementedException` and are refused here as well rather than
  guessed at: the kind 2 of the bit walks of the class `CRip` (`UncompressRgb2`), and the walks of the class
  `CRip007` (`UncompressRgb` and the alpha walk of it behind the counts of `CompressInfo`). A picture of the
  class `CRip007` is therefore **named** as a picture of this engine and refused where its places are asked
  for.
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
fixture. A file of another mark, of another class, of a count of the places of the picture of nothing, of a
kind of no walk, and a picture of the walks of the kind 2 and of the class `CRip007`, are pinned beside them.
