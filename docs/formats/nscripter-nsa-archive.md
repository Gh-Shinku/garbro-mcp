# `nscripter-nsa-archive`

A resource archive of the NScripter engine. The port is read from `ArcFormats/NScripter/ArcNSA.cs`, class
`NsaOpener`, at GARbro's baseline commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`.

## The format

A file begins with the count of its files as a word of two places of the file read **from its high places
down**, and then the place of the tables of the index, of four places of the file, also read downwards. The
place stands counted from the beginning of the file, and the index stands between the head and that place;
the places of the files themselves begin there. The reference begins its walk two places of the file behind
where the first word of the file stands of nought, which is the mark of a file of the engine whose index
stands behind its head.

The index is a run of words, one for every file: the name of the file, of a place of no name behind it, then
thirteen places of the file:

| of what count | what stands there |
| --- | --- |
| 1 | the kind of the walk of the file |
| 4 | the places of the file within the file of the engine, of the place of the tables of the index added to them |
| 4 | the count of the places of the file as they stand |
| 4 | the count of the places the file stands of where its places are packed |

The reference refuses the archive where the place of the tables stands beyond the file, where it stands
before fifteen places of the file for every file of the archive, where a name stands short, where a file
stands of no name of its own, and where the places of a file stand beyond the file of the engine.

## The walks of the places of a file

| the kind | the walk of it |
| --- | --- |
| `0` | the places of the file as they stand |
| `1` | a picture of the engine of the name `spb`, of the walk below |
| `2` | the LZSS of the engine, of the walk below |
| `4` | bzip2 |

**The picture of the name `spb`** stands of the count of the places of the picture as two words of two
places of the file read from their high places down, and then of three walks, one for every place of a colour
of the picture. Every walk of a colour stands of the first place of the colour of the picture and then of
counts of three places of the file: a count of nought stands of four places of the colour of the place in
front of them, a count of seven stands of one more place of the file which names the count of the places of
a count behind it, and every other count names the count itself, of two places more. The picture stands of
the places of the file as a **bitmap** of twenty four places of a colour, of the rows of the picture from
its foot up and of every row of a colour in turn (so the second row walks the other way round).

**The LZSS of the engine** (`Unpacker`, of the counts `EI` of eight and `EJ` of four places of the file, and
of a frame of `1 << EI` places of the file which begins at `N - F`) stands of one place of the file for
every place of it: a place of the stream that stands of one stands of the next eight places of the file, and
one that stands of nought stands of eight and four places of the file, which name a place of the frame of
the walk and the count of the places that stand there, of two places more.

**bzip2** is not carried by this project, so a file of that kind stands turned away (`UNSUPPORTED_FEATURE`)
rather than read. A file whose places stand of the mark of a sound of the engine (`0x90FBFF` in its first
three places of the file) stands of an archive of one file of the name `mp3`, of the whole of the places of
the file.

## Deviations

* The walk of a file of a compressed kind stands of the count of the places the file stands of, and refuses
  a file that names no count at all, where the reference stands of the count the index names without
  checking it.
* The places of a picture of the name `spb` stand checked against the counts of the picture, so a picture
  whose walk names more places than it holds stands refused rather than read past its own end.
* A password (`EncryptedViewStream`) is not carried: the reference reads one out of the settings of the
  user, and this port carries no place to take one from.
* The kind of a file stands of its own name for a sound of the name `nbz` alone, as the reference stands of
  it (`name.HasExtension(".nbz")`), and every other file stands named `file`.

## Verification

`tests/formats/nscripter-nsa.test.ts` builds archives in the test: one of a file of the places as they
stand, whose name, count and places stand pinned and whose places stand handed over place for place; one of
a file of the walk of the engine, whose places stand stood of a walker of the test that stands of the high
place first (a file of the places that all stand on their own); one of a picture of two places by two, whose
bitmap stands of a picture of one colour for every place of a colour; one of a sound of the name `nbz`,
which stands turned away where its places are asked for, and one of the mark of a sound of the engine, which
stands of an archive of one sound; and two files that stand undetected - one whose count of files stands
beyond any archive and one whose place of the tables stands beyond the file.
