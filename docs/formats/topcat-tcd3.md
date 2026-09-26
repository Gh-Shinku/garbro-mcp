# `topcat-tcd3`

A data archive of the TopCat engine. The port is read from `ArcFormats/TopCat/ArcTCD3.cs`, class
`TcdOpener`, at GARbro's baseline commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. The first shape of the
same engine (`ArcFormats/TopCat/ArcTCD1.cs`) is the port `topcat-tcd1`.

## The format

A file begins with `TCD2` or `TCD3` and the count of the files of the archive at 4. The **table of the
sections** begins at 8; every word of it is 0x20 places of the file, and the engine holds four sections for
the second shape and five for the third. The place of a name of each section is fixed by its number:
`.tct`, `.tsf`, `.spd`, `.ogg` and `.wav`.

The words of a section differ between the two shapes:

| the second shape | the third shape |
| --- | --- |
| the count of the places of the section | the count of the places of the section |
| the count of the files | the place of the tables |
| the count of the directories | the count of the directories |
| the place of the tables | the count of the places of a name of a directory |
| the count of the places of a name of a directory | the count of the files |
| the count of the places of a name of a file | the count of the places of a name of a file |

A section stands of no table at all where the word it stands of first is nought (the count of the places of
the section for the second shape, the place of the tables for the third), and is left out of the walk.

Behind the place of the tables a section stands of, in order: the **table of the names of the directories**,
the **table of the directories** (words of 0x10 places of the file: the count of the files of a directory,
the place of its first name within the table of names, the row of its first file within the table of places,
and four places the reference stands of no use of), the **table of the names of the files**, and the **table
of the places** (one more word than the count of the files). Every place of both tables of names stands of
the cipher of the section taken off it, and the cipher itself is the last place of the field of the first
name of the directories, which stands of the cipher where every place of the table stands of it.

The second shape stands of names that follow each other, of a place of no name between them, and the count
it names is the count of the places of the **whole** table; the third shape stands of fields of a count of
their own, one name in each. Every name of a file is then stood of the place of its directory and stands of
the place of the section rather than of its own place (`Path.ChangeExtension`), so a section of the name
`.tct` names scripts and a section of the name `.wav` names sounds.

A file of the engine stands of the walk the place of its name stands of:

* `.tct` and `.tsf`: the count of the places the script unpacks into, and then the LZ walk of the engine
  over the places behind it and a turn of every place of the script to the right by one place;
* `.ogg`: the check words of the pages of the stream stood again, of the walk of `Crc32Normal`;
* `.spd`: a picture of the engine, of the cipher of the engine's own table of keys where it holds one;
* every other name: the places of the file as they stand.

## The check word of a page of an Ogg stream

`Crc32Normal` (`ArcFormats/Crc32.cs`) stands of the polynomial 0x04C11DB7 read from the high places of the
word down, of no place of the file read of the word of the run in front of it and of no other count of the
places of the file behind it - the walk the specification of the format of an Ogg stream stands of as well.
It is **not** the walk of `packages/codecs/src/crc32.ts`, whose table stands of the places of the word read
backwards, so this port carries its own walk (`oggCrc32`) beside the walk of that file. The walk of the
reference leaves the **last** page of a stream alone: it reads a page only where more than the places of the
head of a page stand behind it.

## Deviations

* The table of the keys of the reference (`TcdOpener.KnownKeys`) is not carried: a picture of the engine
  whose places stand of the cipher of the engine's own therefore stands handed over as it stands, which is
  what the reference hands over where its own table is empty as well.
* The places of a file stand checked against the count of the places of the file where the walk reads them
  (`offset + size <= file size`), which the reference does not check at all.
* The count of the places a script unpacks into is bounded (64 MiB) before the walk reads it.
* The reference names the kind of a file through `FormatCatalog.Create` and stands of `image` for a picture
  of the name `.spd` alone; this port names a picture of that name `image` and every other file `file`.

## Verification

`tests/formats/topcat-tcd3.test.ts` builds archives of both shapes in the test. It pins the tables of a
third-shape archive of two sections (a script and a sound), whose names, counts and places stand asserted,
and the walk of every file the places of a name stand of: the LZ walk of the engine and its turn, the check
word of a page of an Ogg stream, and the places of a sound as they stand. It pins a table of the second
shape as well, whose names stand of each other, and it stands of three files the walk turns away: one of
another word at the head, one whose count of files stands beyond any archive, and one standing short of its
own head. The check word of the walk of `Crc32Normal` stands pinned against the published count of the
places of the file of its polynomial for the places of the file `123456789` with the word of the run at
nought and no count behind it (`0x89A1897F`), which was worked out of the count a published table names for
the same polynomial of the places of the file.
