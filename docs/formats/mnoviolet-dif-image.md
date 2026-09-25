# M no Violet incremental picture (`DIF/MnV`)

Format reference: GARbro `ArcFormats/MnoViolet/ImageDIF.cs` (`DifFormat`), GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

The picture is a **difference** against another one: the base picture stands beside it in the same
directory, of the name the head of the difference carries without an extension.

## Head

A head of `0x7C` places holds the name of the base picture and the counts of the two walks of the picture:

| offset | field |
| --- | --- |
| 0 | the mark `dif` and a place of nothing |
| 4 | the name of the base picture, without an extension, up to a hundred places and of a place of nothing behind it |
| 0x68 | the places of the packed index of the difference (`i32`) |
| 0x6C | the places the index turns out (`i32`) |
| 0x70 | the places of the packed difference itself (`i32`) |
| 0x74 | the places the difference turns out (`i32`) |
| 0x78 | the count of the parts of the difference (`i32`) |

## The base picture

The reference asks its own file system for every file that shares the stem of the name the head carries
beside the difference, takes the first of them as the base and hands it to whichever format of its own reads
it. This project keeps that lookup in `shared/companion.ts` (`listCompanionFiles`), which leaves the
difference itself out of the candidates and sorts the rest so that the first of them is the same file from
run to run.

This port reads the base of the two kinds a format of this project can read out of a file on its own: a
**bitmap** (`readBmpImage`) and a **portable network graphic** (`readPngImage`), of twenty four places of a
colour or of thirty two of them, of which the places of the alpha are dropped. The reference hands the base
to any format registered with it, which a format of this project cannot reach, since the registry stands at
the front of the project rather than within a format.

## The two walks of the difference

Both walks stand one behind the other from the end of the head, and both are the plain LZSS of the
reference: a control byte whose set places stand for places of their own, a frame of `0x1000` places of
nothing, and the frame walked from `0xFEE`. The index is read of the count the head names, and the reference
throws where the walk stands short of it; the difference is read for as long as it stands.

The index is a list of parts, of eight places each: the place of a part within the picture and the count of
places of it. The difference is read **on**, part after part, so a part stands of the places behind the ones
the part in front of it took.

## The picture of the difference

The base is taken of twenty four places of a colour, its **rows turned over** - the last row of the base
stands first - with every row **padded to four places**. The places of the difference are copied into that
picture at the places the index names, and the picture is handed over as a picture whose rows stand from the
bottom up, which is the `CreateFlipped` of the reference. The bitmap of this port stores the row of the
picture first that the reference stores first as well, of a positive height, so the two pictures stand of
the same places.

## Deviations

* A difference whose base stands nowhere beside it is not taken as a picture of this engine, which is the
  exception the reference raises on the same file.
* A base of any other kind than a bitmap or a graphic of the two depths this port reads is turned away,
  where the reference would hand it to the format it finds for it.
* A file whose mark is not `dif`, whose name stands empty, whose two walks stand past the end of the file,
  or whose index names more parts than the places it holds, is turned away rather than read past the end.
* A part of the difference that stands past the picture, or one whose places stand past the walk of the
  difference, is turned away rather than read short.

## Tests

`tests/formats/mnoviolet-dif-image.test.ts` writes a base bitmap and a base graphic of two by two places by
hand, of the places this test asks for, and the two walks of the difference as streams of places of their own.

The head, the name of the base (a name that carries a directory included) and the turning away of a name at
nothing, of another mark, of a walk that stands past the file and of an index that names more parts than it
holds are pinned. The composition is pinned of two parts, the first of them on the row the base turns over
and the second on the row in front of it, of the places the fixture asks for: the row of the picture the
first part lands on is the row the picture of the format stores first. A base that stands of a graphic of
its own is pinned beside it, and the turning away of a difference whose base stands nowhere beside it - of a
difference that names itself among them, which the reference turns away as well.
