# rUGP engine picture (`S5I`)

Format reference: GARbro `ArcFormats/rUGP/ImageS5I.cs` (`S5iFormat`, `S5iMetaData`), over the walk of the head
of an object of the engine (`CRioArchive.LoadRioTypeCore`), GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

The picture is the whole of a file of its own rather than an entry of an archive: the file begins with the
mark of an **object** of the engine (`0x29F6CBA4`) rather than with the mark of an archive, and the walk of the
head of that object names the class of it. The class must be `CS5i`; every other class of the engine is a
picture of another walk, or no picture at all.

## The head of the object

| place | field |
| --- | --- |
| 0 | the mark of an object of the engine |
| 4 | the count of the places of the walk of the object, or the tag of the class of it |
| … | the class of the object: the count of the places of its own, the count of its name, and the name |

The word behind the mark stands **twice** in the walk of the engine: the count of the places of the head of the
walk is read of it where that count stands of a schema (`0x10` to `0x3FFF`), and the tag of the class stands of
it where it does not. A schema of `0x10` reads no places behind it; a schema of `0x11` and above reads one more
count of sixteen places (the flags of the object) in front of the tag. A tag of `0xFFFF` names a class the
stream carries itself, of the count of the places of the class and the count of the places of its name.

## The places of the picture

Behind the head of the object, the third and the fourth count of sixteen places are the width and the height of
the picture, of thirty two places of a colour (BGRA) a place, and the places of the picture stand of the schema
of the head:

| schema | the places of the picture |
| --- | --- |
| 0 | right behind the head of the object (at `+0x14` of the object) |
| any other | a count of the places of the picture at `+0x14`, and the picture at `+0x18` |

The picture is handed out as a bitmap of thirty two places of a colour, of the places of the run as they stand.

## Deviations

* The reference reads the count of the places of a picture of a schema and then reads **that count** of places,
  whatever it holds; this port turns away a run shorter than the picture (`width * height * 4`) and reads the
  picture of the count of the picture rather than of the count of the run, so a run longer than the picture
  stands of no places past it.
* A file of no mark of an object, of a class other than `CS5i`, of a count of the width or the height of
  nothing, and of a head that runs past the places of the file, is not a picture of this engine at all.

## Tests

`tests/formats/rugp-s5i-image.test.ts` builds both pictures: one of the walk of no schema, whose places stand
right behind the head of the object, and one whose head stands of a schema and of a count of the places of the
picture. Both are read back with the reader of the project (`readBmpImage`) rather than held against a header
of their own, so the counts, the places of the colours and the turn of the rows are all of them held to the
fixture. A file of another mark, of another class, a picture of no places at all, and a picture whose run is
shorter than the count of its places are pinned beside them.
