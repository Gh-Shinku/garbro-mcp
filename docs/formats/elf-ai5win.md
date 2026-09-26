# `elf-ai5win`

A resource archive of the AI5WIN engine. The port is read from `ArcFormats/elf/ArcAi5Win.cs`, class
`ArcAI5Opener`, at GARbro's baseline commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`.

## The format

The count of the pictures of the engine stands of a word of four places at 0. Behind it stand the records of
the index, of a name of a count the engine chose for the game at hand and of eight places of the file behind
it:

| at | of what count | what stands there |
| --- | --- | --- |
| 0 | the count of the places of a name of the scheme | the name of the picture, every place exclusive-ored with the scheme's cipher of names |
| behind the name | 4 | the count of the places of the picture, exclusive-ored with the scheme's cipher of counts |
| behind that | 4 | the places of the picture, exclusive-ored with the scheme's cipher of places |

The places of the pictures themselves begin behind the last record, so the count of the places of the index
follows from the count of the pictures and the count of a name alone. The reference reads a name up to the
first place that stands of nought once exclusive-ored, refuses a name that carries a place below 0x20 or that
reaches the end of the field of the name without such a place, and refuses a picture whose places stand
within the index or beyond the file.

## Where the shape of the index comes from

The count of a name and the three ciphers stand of **no place of the file**. The reference reads them from a
table of schemes of its own (`KnownSchemes`, filled from the settings of the user and from the format
database of the engine) and, where the table holds no scheme for the game at hand, from the index itself:
`Ai5ArcIndexReader.GuessSchemes` tries the four counts of a name the engine is known to use (0x14, 0x1e, 0x20
and 0x100) and, for each of them, reads the cipher of the names off the **last place of the field of the
first name** (which stands of the cipher itself where the name is shorter than the field and the engine
padded the field with places of nought exclusive-ored), takes the cipher of the places from the first picture
of the file, whose places must stand behind the index and within the file, and the cipher of the counts from
the place of the **second** picture, which the cipher of the places names.

A stock build of the reference leaves `KnownSchemes` empty - the table is filled by the user - so the guess
is the walk a stock build stands of, and it is the walk this port carries: this port reads the shape of the
index out of the index itself and holds no scheme table.

## What the port does with the places of a picture

The places of a picture are read as they stand, except for the names `mes`, `lib`, `a`, `a6`, `msk` and `x`,
which stand of the LZSS walk of the engine (`GameRes.Compression.LzssStream`, the walk of
`packages/codecs/src/lzss.ts`), which this port takes over the whole of the places of the picture.

## Deviations

* The reference reads one place of the file **beyond** the count of a name of the scheme while it looks for
  the place of no name that ends a name (`if (n > scheme.NameLength)`), so a name whose place of no name
  stands outside the field may still be read there. This port stands of the count itself: a name of no place
  of no name within the field is refused.
* The schemes of the reference's own table are not carried, because a stock build carries none either; a
  caller of this port cannot hand one in.
* The reference names the kind of a picture through `FormatCatalog.Create` and this port names every entry
  `file`, as elsewhere in this port.

## Verification

`tests/formats/elf-arc-ai5win.test.ts` builds archives in the test, of the three ciphers and of a count of
the places of a name of the scheme standing of no place of the file: one of two pictures, whose names, counts
and places stand pinned (two of the four counts of a name are exercised, 0x14 and 0x100, so the guess is
pinned to reading the shape rather than to one count); one whose picture of the name `mes` stands of the LZSS
walk; and four files that stand undetected - one of no cipher the guess may read, one whose name carries a
place below the least place of a name of the engine, one whose name stands of no place of no name within the
field, and one of one picture alone, of which the reference reads no shape at all.
