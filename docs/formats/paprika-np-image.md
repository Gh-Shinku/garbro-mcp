# Paprika NP picture (`PIC/NP`)

Format reference: GARbro `Legacy/Paprika/ImageNP.cs` (`NpFormat`, `NpReader`), GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## Head

The file starts with the letters `NP`, then the byte `0x01` and the byte `0x00`, and

| offset | field |
| --- | --- |
| 2 | the count of the frames of the file (`u16`), of which the reference reads the first alone |
| 4 | the width of the picture (`u32`) |
| 8 | the height of the picture (`u32`) |
| 12 | the place of the walk (`u32`) |

A count of no frames, a picture of no places or a place of a walk beyond the file is turned away. The
picture is twenty four bits a place.

## The walk

At the place of the walk stand the count of the places the walk turns out and the count of the packed
places behind them (`i32` each), and then the stream itself. The walk holds thirty two places of that
stream and takes a byte at a time, most significant bit first.

Its codes stand in two tables the reference carries itself (and this port carries as `np-tables.ts`):

* `bitMap` holds sixteen pairs of a count of places and a place: four places of the stream name a pair,
  the count of the pair names how many places of a code stand behind them, and the place names where in
  the list of words the code begins;
* `wordList` is that list of two hundred and seventy four words: the places of a picture below 0x100 and
  the tokens of a run above it;
* `dword_4257CC` holds eight pairs of a count of places and a base for the **count** of a long run, and
  `dword_425810` seven pairs of the like for its **place**: three places of the stream name a pair, the
  base is shifted nine places and the count of places behind it carries the rest of the distance.

A word below 0x100 is a place of the picture. A word of 256 to 263 is a run whose count stands in the
word. A word above it is a run whose count and place stand in the two tables above. The place of a run
reaches back into a **ring of 0x10000 places** that every place the walk writes is copied into as well,
which is what lets a run reach over the picture alone; a run that reaches before the start of the ring
turns to its end. Behind a run the walk moves four places further on than the run was long, and those four
places stand at nothing.

One token (the word 272) rebuilds the codes of the two tables from the counts of the words read so far:
the pairs `(word, count)` are sorted by `sub_416E80` (which halves every count as it takes it) through
`sub_416DC0`, a shell sort of the reference's own with the gaps 40, 13, 4 and 1, and the codes behind them
are then read from the stream, a count of places at a time, as a run of clear places behind a set one. The
sort of the reference reads its records two places off the pairs they came from, which this port copies as
it stands rather than as it was meant, since the order it leaves is what the codes behind it stand of. The
word 273 ends the walk.

## Deviations

* A place of a walk beyond the file, a walk that names a word beyond its list, or a walk that runs past the
  picture is a broken picture rather than the exception the reference would raise: the walk stops, and the
  picture keeps the places it has.
* A picture whose walk declares no more places than the twenty eight the head of the picture takes is
  turned away, where the reference would build an array of a count below it.
* The ring of the reference is written with `m_output[dst]` - **the first place of a run** - once for every
  place of it, where the walk it was written out of copies the range itself. The two agree for a run of one
  place and part for any longer one, so this port copies the first place as the reference does. It is the
  only place the port knowingly follows the reference against the walk it came from.

## Tests

`tests/formats/paprika-np-image.test.ts` writes the stream of the format with a bit writer of its own, most
significant bit first, and builds every token of it out of the tables of the reference: a prefix of four
places and then the code of the pair that prefix names. Its picture holds five hundred and twelve places of
a period of three colours, then a run of four places that reaches five hundred and twelve places back - the
start of the ring, which is the start of the picture - and then a run of twelve places that reaches ten
hundred and twenty four places back, before the start of the ring.

The places the walk turns out are then the values the tokens ask for: the period of the picture, the four
places the first run reaches over (which the fixture asks for by name), the four places behind it that
stand at nothing, and the places the second run leaves as they were. The picture the format hands over (its
two headers, its top down rows and its places) is pinned beside them, as are the head and the turning away
of a mark of another engine, of a count of no frames, of a picture of no places and of a walk of no places.

The checksum of the places of the picture was worked out with a transcription of the walk of the reference
(`NpReader`, its two sorts and its ring); the places themselves are the ones the fixture asks for rather
than a recording of what the walk did, so a slip in the tables, in the walk or in the ring shows up as a
difference. The token that rebuilds the tables (the word 272) is not reached by a fixture yet: the walk
carries it, and its place is on the list of what is left to check in `docs/support-status.json`.
