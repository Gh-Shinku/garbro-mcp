# KaGuYa script engine resource archive (`ARC/LINK`)

Format reference: GARbro `ArcFormats/Kaguya/ArcLINK.cs` (`LinkOpener`, `LinkEntry`, `LinkArchive`,
`LinkReader`, `Link4Reader`, `Link6Reader`, `BmrDecoder`, `ParamsDeserializer`), and the `UnpackLzss` of
`ArcFormats/Kaguya/ArcLIN2.cs`, which this project already carries as `unpackLin2` of `kaguya/lin2.ts`.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## Head

The file starts with the letters `LINK` and a version digit at offset 4. A digit below `3` takes the older
layout (below); the digits 3 to 6 take the record walk, whose first record stands at

| version | first record |
| --- | --- |
| 3 | 8 |
| 4 and 5 | 0xA |
| 6 | `8 + <the byte at 7>` |

The sixth layout keeps a field of its own behind the head, and the byte at 7 says how many of its places
stand between the head and the first record.

## The record walk

Every record is

| size | field |
| --- | --- |
| 4 | the places of the whole record, from its own start (`u32`) |
| 2 | the flags (`u16`) |
| 7 | skipped |
| 1 or 2 | the length of the name |
| 2 or 0 | two skipped bytes (the older layouts only) |
| n | the name |
| rest | the places of the entry |

A record of no places ends the walk, and one of fewer than 0x10 places is refused. The older layouts read
the name as a null terminated cp932 string inside a field whose length the byte before it holds; the sixth
reads a word of length and a UTF-16 name, whose trailing null this port drops (the reference keeps it,
because it hands the whole field to `Encoding.Unicode`).

The flags carry the two facts the entries need: `flags & 3` says the entry may be packed and `flags & 4`
that it is encrypted. A packed entry is one whose first three places carry the letters `BMR`, and the word
behind them is the count of the places of the entry. Note that the reference reads **four** places for that
mark and compares only the three letters of it.

The places of an entry are the rest of its record, so its count is the count of the record less the places
of its head and its name, which is what the reference computes from the stream position.

## The older layout

A version digit below 3 keeps its names and its places apart: the count (`i32` at 4), the places of the
names (`u32` at 8), then that many null terminated cp932 names from offset 12, then a place (`u32`) and a
count (`u32`) for every entry, and then the data itself. Every place and count is checked against the file.

## Extraction

* A plain entry whose places carry the letters `BM` at offset 5 is a picture stored through the Lin2 walk
  of the same engine: the word at its start is the count of the places it unpacks to, and the walk itself
  stands behind that word. The `unpackLin2` of `kaguya/lin2.ts` reads it.
* A packed entry is the `BmrDecoder` walk below.
* Every other entry stands as it is.
* An encrypted entry needs the scheme of the game, which `LinkReader.GetEncryption` reads out of a
  `params.dat` beside the archive; that file ships outside this port, so such an entry is refused with
  `UNSUPPORTED_FEATURE`. The index of an archive that carries one is still listed.

## The walk of a packed entry

The head of a packed entry is a byte at offset 3 that names how many columns the runs of the entry are
taken down, the count of the places of the picture it unpacks to (`i32` at 4), the key of the walk (`i32`
at 8) and the count of the places the tree walk itself lays down (`i32` at 12). The bit stream begins at
0x14.

The stream carries its own tree: one letter of `1` stands for a branch whose two children follow it, and a
letter of `0` for a leaf whose colour is the eight letters behind it. The places of the walk stand behind
the tree, a letter each. They are then

1. read through the dictionary of a move to front walk, which every place names;
2. walked by their own colour: the reference counts the colour of every place, sorts the places of the
   stream by that colour (the lower place winning a draw), and then reads them out of a chain that starts
   at the key of the head, a place at a time;
3. and, where the byte at offset 3 stands clear of nothing, spread over that many columns with the runs of
   a picture: a colour equal to the place before it in the column is followed by a count, whose high letter
   set means a second letter carries the rest of it.

A chain that walks outside the places of the stream is refused as `INVALID_ARCHIVE`, where the reference
would read outside its own table.

## Tests

`tests/formats/kaguya-link-archive.test.ts` builds its archives out of the reference's own record layout:
the head of the three newer versions (including the sixth's byte of length and its UTF-16 names), the older
layout with its names and its places apart, an entry whose `BM` places carry a Lin2 walk of a picture, and
two packed entries whose tree, places and head are written out by hand.

The places the packed entries unpack to stand from an **independent transcription** of the walk (the move
to front, the sort by colour and the runs), which is also what the four groups of its own output pin: the
places of a walk of two colours, the same walk with a key of its own, and two runs of columns. The refusals
covered are an encrypted entry, a mark of another engine, a record of fewer places than the reference asks
for, and a record whose places reach past the file.
