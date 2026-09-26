# Macromedia Director resource archive (`DXR`)

Reference: GARbro `ArcFormats/Macromedia/ArcDXR.cs` — class `DxrOpener` — over the walks of
`ArcFormats/Macromedia/DirectorFile.cs` — classes `DirectorFile`, `MemoryMap`, `MemoryMapEntry`,
`KeyTable`, `DirectorConfig`, `Reader` — at GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`,
MIT License.

A movie of the engine is a container of the places of a picture of the engine: the word `XFIR` (or `RIFX`),
the counts of the places of the movie, the word of the kind of the walk of the engine, and then the counts of
the walk of the engine of the places of the picture of the engine of the movie.

## The head

| offset | field |
| --- | --- |
| 0 | `XFIR`, of the counts of the places of the picture of the engine of the engine itself, or `RIFX` |
| 4 | the counts of the places of the movie |
| 8 | the word of the kind of the walk of the engine |

The word `XFIR` stands of the counts of the walk of the engine of the counts of the places of the picture of
the engine of the engine itself (little endian) and `RIFX` of the counts of the engine itself (big endian), and
every count of the walk of the engine of the counts of them stands of the counts of the places of the engine of
the walk of the engine of the counts of the movie.

The words of the kind of the walk of the engine are `MV93` and `MC95`, whose counts of the walk of the engine
stand of the map of the places of the picture of the engine, and `FGDC` and `FGDM`, whose places of the
picture of the engine stand of the counts of the walk of the engine of the engine itself (`Fver`, `Fcdr`,
`ABMP`, `FGEI` and `ils`). A movie of a word the reference does not know stands of no counts of the walk of
the engine at all.

## The map of the places of the picture of the engine

The counts of the walk of the engine of the places of the picture of the engine stand of the map of the
counts of them: the counts of a movie of the kinds of the engine hold the count of the walk of the engine
`imap`, which names the place of the count of the walk of the engine `mmap`. The count of the walk of the
engine `mmap` stands of the counts of a picture of the engine of its own, and then of the counts of the places
of the picture of the engine:

| offset | field |
| --- | --- |
| 0 | the count of the places of the counts of them |
| 2 | the count of the places of every count of them |
| 4 | the count of the places of the picture of the engine of the movie |
| 8 | the count of the counts of the places of the picture of the engine the movie stands of |
| 0xc | eight counts of no place |
| 0x14 | the place of the counts of the walk of the engine of the places of the picture of the engine that stand of no counts at all |

Every count of the places of the picture of the engine then stands at the count of the places of the head of
the map of the counts of them, at the count of the places of every one of them:

| offset | field |
| --- | --- |
| 0 | the counts of the walk of the engine of the count of the places of the picture of the engine |
| 4 | the counts of the places of the count of the walk of the engine |
| 8 | the place of the count of the walk of the engine, which stands of the counts of the places of the word of the head of the movie of the engine that stand in front of them |
| 0xc | the counts of the walk of the engine of the count of the places of the picture of the engine |
| 0xe | the count of the walk of the engine that stands behind the count of the places of the picture of the engine |

## The keys of the picture of the engine and the counts of the places of the movie

Behind the map of the places of the picture of the engine the reference reads two counts of the walk of the
engine of the places of the picture of the engine, at the places the map names:

* The keys of the picture of the engine (`KEY*`): the count of the places of a count of them, two counts of no
  place, the counts of the places of the picture of the engine of the count of the walk of the engine, and the
  count of the keys the movie stands of. The reference then stands of the **whole** of the table of the keys,
  of the count of the counts of the places of the picture of the engine it read at the head of the count of the
  walk of the engine, and not of the count the movie stands of: every count of the places of the picture of the
  engine stands of the count of the places of the picture of the engine it stands of, of the counts of the
  places of the picture of the engine of the count of the walk of the engine it stands of, and of the counts
  of the walk of the engine of the picture of the engine itself.
* The counts of the places of the movie of the engine (`VWCF`, of the older counts of the engine `DRCF`): the
  counts of the places of the picture of the engine of the movie of the engine at fixed places of the count of
  the walk of the engine, whatever the counts of the walk of the engine of the places of the head of the movie
  of the engine - the reference stands of the counts of the engine of the walk of the engine itself
  (`reader = reader.CloneUnless (ByteOrder.BigEndian)`), so a movie of the counts of the walk of the engine of
  the counts of the places of the picture of the engine of the engine itself stands of the counts of them just
  as one of the counts of the engine itself. The count of the places of the picture of the engine that stands
  of the picture of the engine of the movie of the engine stands at the count of the places of the picture of
  the engine of the count of the walk of the engine of the version of the movie of the engine: of the counts
  of the engine behind one thousand two hundred at `0x4E`, and of the counts of the engine itself at `0x46`.

The counts of the walk of the engine of the places of the picture of the engine of the movie of the engine
stand of the counts of them, at the places of the picture of the engine of the counts of the places of the
picture of the engine of the map of the counts of them (`GetChunkReader`), and no counts of the walk of the
engine of the places of the picture of the engine stand of the counts of the walk of the engine of the counts
of the engine itself: a count of the places of the picture of the engine that stands behind the end of the
movie of the engine stands of no counts of them at all.

## The counts of the walk of the engine the reference lists

The reference lists every count of the places of the picture of the engine of the counts of the walk of the
engine `RTE0`, `RTE1`, `FXmp`, `VWFI`, `VWSC`, `Lscr`, `STXT`, `XMED` and `File`, of the counts of the places
of every one of them, under the name of the count of the places of the picture of the engine of the count of
the walk of the engine itself: six places of the count of the places of the picture of the engine, a place,
and the counts of the walk of the engine itself, of the counts of the places of the walk of the engine that
stand of no counts at all at the counts of their own. The count of the walk of the engine `File` stands of the
counts of the walk of the engine of the count of the walk of the engine itself as well: its count of the walk
of the engine stands of the counts of the places of the word of the head of the movie of the engine in front
of the places of the picture of the engine of the count of the walk of the engine.

A count of the places of the picture of the engine of the counts of the walk of the engine `STXT` stands of
the counts of the places of the picture of the engine of a text of the movie: the count of the places of the
picture of the engine of the count of the walk of the engine itself, which the reference stands of as of the
counts of the places of the engine of the walk of the engine of the counts of the places of the picture of the
engine of the counts of the walk of the engine (`Binary.BigEndian`), whatever the counts of the places of the
picture of the engine of the movie, and then the text of it.

## Deviations

* The port reads the words of the head and the map of the places of the picture of the engine, and lists the
  counts of the walk of the engine of the engine itself. The counts of the walk of the engine of the places of
  the picture of the engine that the reference reads behind the map - the keys of the picture of the engine
  (`KEY*`), the counts of the walk of the engine of the places of the picture of the engine (`VWCF`, `DRCF`)
  and the counts of the places of the picture of the engine of the counts of the walk of the engine
  (`MCsL`, `CAS*`), and the pictures and sounds of the counts of the places of the picture of the engine -
  stand unported.
* The reference stands of no movie of the engine at all where the counts of the places of the walk of the
  engine of the picture of the engine, of the counts of the places of the picture of the engine itself or of
  the counts of the places of the picture of the engine of the counts of the walk of the engine stand behind
  it: this port stands of the list of the counts of the walk of the engine of the engine itself alone, which
  needs the map of the places of the picture of the engine alone.
* A movie of the counts of the walk of the engine of the engine itself (`FGDC`, `FGDM`) stands of the counts
  of the walk of the engine of the places of the picture of the engine of the engine itself, which the
  reference stands of and this port has not taken: such a movie stands of the counts of the engine of this
  port and stands of no counts of the places of the picture of the engine at all where its counts of the walk
  of the engine stand read.
* A count of the places of the picture of the engine that stands at no count of the places of a picture of the
  engine at all stands of no counts of the walk of the engine of the places of the movie of the engine: the
  reference stands of the counts of the walk of the engine of the engine itself at such a count and its own
  counts of the walk of the engine stand behind, which this port refuses.

## Tests

`tests/formats/macromedia-dxr.test.ts` builds movies in the test:

* the word of the head, the word of the kind of the walk of the engine, the map of the places of the picture
  of the engine and the counts of the walk of the engine of the places of the picture of the engine of every
  count of them, of the counts of the walk of the engine of the places of the engine of the counts of the
  movie,
* the list of the counts of the walk of the engine of the engine itself: their names, the counts of the
  places of every one of them, and the count of the walk of the engine `File`, which stands of the counts of
  the walk of the engine of the places of the head of the movie of the engine,
* the counts of the places of the picture of the engine of a text of the movie, of the counts of the places
  of the picture of the engine of the count of the walk of the engine itself of the counts of the walk of the
  engine (`STXT`),
* a movie of the counts of the walk of the engine of the counts of the places of the picture of the engine of
  the engine itself (`RIFX`),
* the keys of the picture of the engine: the counts of the places of the picture of the engine of the count
  of the walk of the engine, the count of the keys the movie of the engine stands of, and the whole of the
  table of them,
* the counts of the places of the movie of the engine: the counts of the places of the picture of the engine
  of the movie of the engine, of both orders of the words of the head of the movie of the engine (which stand
  of the counts of the engine of the walk of the engine itself every time), and the count of the places of the
  picture of the engine of the count of the walk of the engine of the version of the movie of the engine, in
  front of one thousand two hundred and behind it,
* the counts of the places of the picture of the engine of the movie of the engine handed out of the counts
  of the walk of the engine of the places of the picture of the engine of the movie of the engine,
* the counts of the walk of the engine of the places of the picture of the engine of a movie of the engine
  that stand behind the counts of the walk of the engine of the places of the picture of the engine of the
  movie of the engine, of the keys of the picture of the engine and of the counts of the places of the movie
  of the engine alike,
* the refusals: a word of another picture of the engine, a word of the kind of the walk of the engine the
  reference does not know, a movie of no counts of the places of the picture of the engine at all, a count of
  the places of the head of the map of the counts of them that stands of no counts of them, a count of the
  places of a count of them that stands of no counts of them, and a movie of the counts of the walk of the
  engine of the engine itself.

## References

- `GARbro/ArcFormats/Macromedia/ArcDXR.cs` — `DxrOpener.TryOpen`, `DxrOpener.OpenEntry`,
  `DxrOpener.OpenChunkStream`, `DxrOpener.RawChunks`
- `GARbro/ArcFormats/Macromedia/DirectorFile.cs` — `DirectorFile.Deserialize`, `DirectorFile.ReadMMap`,
  `DirectorFile.ReadKeyTable`, `DirectorFile.ReadConfig`, `DirectorFile.GetChunkReader`,
  `MemoryMap.Deserialize`, `MemoryMapEntry.Deserialize`, `KeyTable.Deserialize`,
  `KeyTableEntry.Deserialize`, `DirectorConfig.Deserialize`, `Reader.CloneUnless`
