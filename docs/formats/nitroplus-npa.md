# NitroPlus resource archive (`NPA`)

Format reference: GARbro `ArcFormats/NitroPlus/ArcNPA.cs` (`NpaOpener`, `NpaEntry`, `NpaArchive`,
`EncryptionScheme`, `Indexer`), GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## Head

The file starts with the four letters `NPA\x01`. The head runs to offset 41 and holds, in order:

| offset | field |
| --- | --- |
| 7 | key 1 (`i32`) |
| 11 | key 2 (`i32`) |
| 15 | the archive stores its entries compressed (`u8`) |
| 16 | the archive is encrypted (`u8`) |
| 17 | the count of the records of the index (`i32`) |
| 21 | the count of the folder records (`i32`) |
| 25 | the count of the file records (`i32`) |
| 37 | the size of the index (`u32`) |

The reference refuses the archive when the count of the records is smaller than the folders and the files
beside it, and when the size of the index reaches past the file.

An encrypted archive needs the scheme of the game, which the reference looks up in a table that ships
empty and otherwise asks the user for; every scheme it knows lives outside this port, so an encrypted
archive is refused with `UNSUPPORTED_FEATURE`.

## The key of the archive

The key is the product of the two words of the head, with the thirty two bit wrap of the reference's own
arithmetic. The reference adds the two words for the Lamento scheme instead, and that scheme is reachable
only through the encrypted path this port refuses, so the product stands for every archive it opens.

Every place of a stored name carries the amount `DecryptName` returns for the place it stands at, the
number of the record and the key of the archive: a step of `0xFC` per name place, less the four bytes of
the key and the four bytes of the record number, taken as they are at run time and read out one at a time.
The writer subtracts the same amounts, which is what the fixture of this port does.

## The index

The records follow the head and run to `41 + dirSize`. Every record is

| size | field |
| --- | --- |
| 4 | the count of the bytes of the name (`i32`) |
| n | the name, every byte carrying its own amount |
| 1 | the type: 1 for a folder, 2 for a file |
| 4 | the number of the folder of the entry (`i32`) |
| 4 | the place of the entry in the payload, without the head and the index (`u32`) |
| 4 | the places of the file of the entry as it stands stored (`u32`) |
| 4 | the places of the file of the entry as the reference reads it out (`u32`) |

A type of 1 makes a folder record, which the reference leaves out of its listing. A name count taken as
an unsigned word that reaches the size of the index, or a record that reaches past the end of the file,
ends the walk. The name of a file record is the whole relative path of the entry, with the separators of
the platform the archive was written on, which this port turns into forward slashes.

The places of an entry in the file are `dirSize + offset + 41`, where `offset` is the word of the record
and 41 is the size of the head. The reference checks that place and the stored size against the file,
which this port does too, so an index that points outside the file is refused as `INVALID_ARCHIVE` rather
than read.

## Extraction

The head says whether the entries of the archive are stored compressed; an entry of such an archive is a
zlib stream, which this port reads with `inflateZlibBuffer`.

Two deviations, both of them noted here rather than in a comment alone:

* The reference clears the compressed flag for the entries whose extension names a picture, which it
  looks up in the whole format catalog. This port keeps the flag of the head for every entry and decides
  at extraction by the zlib head of the payload instead (`0x78`-like method byte 8 and a check that
  divides by 31). Every archive the reference itself writes hands over the same bytes either way.
* A payload the head calls compressed but that does not hold a whole zlib stream is handed over as it
  stands, where the reference's reader would throw.

## Tests

`tests/formats/nitroplus-npa.test.ts` builds archives with a writer written out of the reference's own
`Indexer` and `NpaOpener.Create`: the head, one record per entry with the name amounts subtracted, and the
payloads behind the index. The name arithmetic of the fixture is written out of the reference a second
time for the test alone, and four groups of values it produces (the default keys, a second pair of keys, a
negative key and the port's own function against the transcription) are pinned.

The fixtures cover the head, the listing with a folder record left out, the names restored from their
amounts (including a name of the two byte letters of cp932), a plain entry, a zlib packed entry, the
fallback of a payload that is not a whole stream, and the refusals of an encrypted archive, of a mark that
differs, of a count of the records smaller than its own folders and files, of a record that reaches past
the file, of an index that reaches past the file, and of an entry whose own places of the file reach past
it.
