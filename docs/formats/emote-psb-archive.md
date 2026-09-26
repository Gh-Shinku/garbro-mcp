# `emote-psb-archive`

A container of pictures of the E-mote engine. The port is read from `ArcFormats/Emote/ArcPSB.cs`, classes
`PsbOpener` and `PsbReader`, at GARbro's baseline commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`.

## The container

A file begins with the word `PSB`, then the kind of the file and its flags as two words of two places of the
file at 4, and then a head of six places of four places each (of eight for a file of a kind beyond three):

| at | what stands there |
| --- | --- |
| 0x04 | the place of the tables of the names |
| 0x08 | the place of the table of the names of the file |
| 0x0C | the place of the places of the names |
| 0x10 | the place of the places of the chunks |
| 0x14 | the place of the counts of the chunks |
| 0x18 | the place of the places of the chunks themselves |
| 0x1C | the place of the root object of the file |
| 0x24, 0x28, 0x2C | the three tables behind those, of a file of a kind beyond three |

Every one of those places must stand at 0x28 or behind it, in front of the place of the chunks, and within
the file, and the root object must stand of a **dictionary** (the kind 0x21 of the file). A file whose flags
name the cipher of the engine stands of that cipher over the places of the file that stand between the
tables of the names and the places of the chunks.

## The cipher of the engine

`PsbReader.Decrypt` stands of six places of the file: the first three are the places of the engine
(0x075BCD15, 0x159A55E5 and 0x1F123BB5), the fourth is the key of the game (the reference holds one key,
970396437), and the fifth and the sixth stand of nought. Every four places of the file the walk stands of a
new place of the key, and every place of the file stands exclusive ored with the low place of that one. The
port carries this walk as its own class (`PsbCipher`), of the key the reference holds, and its counts stand
pinned in the test against an implementation of the same walk written in another language.

## The objects of the file

An object stands at a place of the file of its own, and the kind of the object stands of the place itself:
nothing (1), the true and the false (2 and 3), the counts (4 to 8, of nought to four places of the file),
the long counts (9 to 0x0C, of four places of the file and of one, of two or of three behind them), the
names (0x15 to 0x18), the chunks (0x19 to 0x1C), the places of the file of a count (0x1D and 0x1E), the
places of the file of a count of eight places (0x1F), the lists (0x20), the dictionaries (0x21), and the
chunks of the newer tables (0x22 to 0x25).

A **table** of objects stands of its own head: the first place of the file stands of the kind of the count of
the objects of the table (so the count stands between one and four places of the file behind it), and the
place of the file in front of the first object stands of the count of the places of one object (between one
and four). A **dictionary** stands of a table of the names of its objects (of the places of the table of the
names of the file) and, behind it, of a table of the places of its objects, every object standing of that
place of the file.

A **name** of the file stands of the two tables of the names: the first names, for every place of the second,
the place the walk of a name stands at, and the second names the place of the file a place of the walk stood
at behind the place it names. The walk of a name stands of the places of the name, of one place of the file
each, and ends at the place of no name, where the first table names the object the name stands of. A place of
the file that stands beyond the first table, or whose place behind it stands of another, ends the walk.

## What the port does with an archive

`PsbOpener.OpenArcFile` stands of the first of three walks that names a file: the pictures of the
dictionary of the **source** of the file (of a picture and of an icon of each object of it), the **layers**
of the file (of the chunk each layer's own name stands of), and every object of the root dictionary that
stands of a **chunk** of the file. The port stands of the same order, and the places of a chunk of the file
- which stand of the place of the chunks of the file and of the count of the chunk - stand handed over as
they stand.

## Deviations

* The **decoder of a picture** of the engine (`PsbTextureDecoder`) is not carried, and neither is the TLG
  picture a layer stands of: the places of a chunk stand handed over as they stand. This is what the
  reference hands over as well where the walk of a picture stands of no place of the file of its own.
* A file whose **head** stands of the cipher of the engine as well (the first flag) stands refused, where
  the reference stands of that cipher of the key of the game. The reference's own head cipher stands of the
  same key, and a stock build holds the one key above.
* The kinds of the names of the files of the engine stand of the name `file` alone, where the reference
  stands of its table of the places of a name; a picture stands named `image`.
* A dictionary whose names stand of no name of the file stands refused rather than read.

## Verification

`tests/formats/emote-psb-reader.test.ts` builds archives in the test: a table whose every place names the
place of the walk behind it and a table that names the place behind every place of the first, of one name,
of the object that name stands of, of a dictionary of one key, and of a chunk of the file. The head and its
refusals stand pinned, the walk of a name and the whole of the names, the object of a dictionary and the
refusal of an object of no kind, the cipher of the engine against a second implementation of its walk in
another language and against a file whose tables stand of the cipher, and the archive itself - its listing,
the count of its files and the places of a chunk handed over place for place.
