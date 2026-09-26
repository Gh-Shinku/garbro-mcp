# CVNS engine resource archive, newer layouts (`CPZ`)

Format reference: GARbro `ArcFormats/Cmvs/ArcCPZ.cs` (`CpzOpener`, `CpzArchive`, `CpzEntry`, `ArchiveKey`),
`ArcFormats/Cmvs/CpzHeader.cs` (`CpzHeader`), `ArcFormats/Cmvs/CmvsMD5.cs` and
`ArcFormats/Cmvs/HuffmanDecoder.cs`, GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.
The older layouts of the same engine stand of their own openers (`cmvs-cpz1`, `cmvs-cpz2`).

## Head

The mark of the file reads `CPZ` and then the place of the version: `CPZ5`, `CPZ6` or `CPZ7`. The head of the
layouts below the seventh stands of `0x40` places, the head of the seventh of `0x48`, and every field of it
stands of a constant the version names:

| place | field |
| --- | --- |
| 4 | the count of the directories (`i32`) |
| 8 | the count of the places of the rooms of the directories (`i32`) |
| 0x0C | the count of the places of the runs of the file records (`i32`) |
| 0x10 | the digest of the whole index (sixteen places) |
| 0x20 | four words of the head, which the MD5 of the engine reads as its message |
| 0x30 | the master key (`u32`) |
| 0x34 | whether the places of the entries stand taken apart (`u32`) |
| 0x38 | the key of the entries, of the layouts above the fifth alone (`u32`) |
| 0x3C | the sum of the first `0x3C` places of the head |
| 0x40 | the count of the places of the key behind the index, of the seventh layout alone (`i32`) |
| 0x44 | the sum of the first `0x40` places of the head, of the seventh layout |

The sum begins at `0x923A564C` where the layout stands below the seventh and at
`(uint) places at 0x40 - 0x6DC5A9B4` where it stands of the seventh, so the count of the key behind the index
is read twice: once as the sum of the head stands of it, and once as the count itself. The count of the
seven places of the key stands behind the `^ 0x65EF99F3` of the field; the head of the entries stands of
`(0x13712765 + 0x7DA8F173 * RotR(field, 5)) mod 2³²` where the layout stands above the fifth.

## The index

The index stands behind the head, of the count of the places of the rooms of the directories and of the runs
of the file records together, and of the count of the key behind it where the seventh layout names one. Its
places are held to the digest of the head, so an index whose sixteen places at 0x10 of the head are not the
MD5 of it is not an index of this engine.

The rooms of the directories stand first, one record a directory:

| place | field |
| --- | --- |
| 0 | the count of the places of the record (`i32`) |
| 4 | the count of the files of the directory (`i32`) |
| 8 | the place of the run of its file records within the runs of the file records (`i32`) |
| 0x0C | the key of the directory (`u32`) |
| 0x10 | the name of the directory, to the end of the record |

A directory named `root` names no room of its own, so the names of its entries stand as they are; every other
directory stands in front of the names of its own entries, of the separator the engine's paths carry.

The runs of the file records stand behind the rooms of the directories, one record an entry:

| place | field |
| --- | --- |
| 0 | the count of the places of the record (`i32`) |
| 4 | the place of the entry behind the index (`i64`) |
| 0x0C | the count of the places of the entry as it stands (`u32`) |
| 0x10 | the check sum of the entry (`u32`), which the reference reads and never stands of |
| 0x14 | the key of the entry within its directory (`u32`) |
| 0x18 | the name of the entry, to the end of the run of its directory |

The seventh layout carries its places as four places longer, so the check sum and the key of an entry of it
stand at `0x14` and `0x18`.

## The walks

Every place of the index stands of the digest the head carries, of a secret of twenty-four words the engine
ships, and of the master key:

| walk | places |
| --- | --- |
| `DecryptIndexStage1` | the whole index: `RotR((secret ^ word) + addend, shift) + 0x01010101` a word, of a turn of seven to twenty-two places |
| `Cpz5Decoder.Decode` | the rooms of the directories, of the key `0x3A` |
| `DecryptIndexDirectory` | the rooms of the directories, of a seed of `0x76548AEF` and of the key of a directory |
| `Cpz5Decoder.Decode` | the run of the entries of every directory, of the key `0x7E` |
| `DecryptIndexEntry` | the run of the entries of a directory, of a seed that walks a turn of its own |

The key of a directory stands of the digest and of `(dirKey + {0x76A3BF29, 0, 0x10000000, 0})`, and the key
of an entry of the archive of `(masterKey ^ entryKey) + dirCount`, of the count of the key of the walk of
`Cpz5Decoder` and of the key of the entries the head names. Every one of those walks is carried **both ways**
by the reference, which is what the fixtures of the test stand of. The places of the key behind the index of
the seventh layout are packed with the Huffman tree of the engine, and the run of them stands of the first
three places of a word of the key of four within the head of it.

## Payloads

An entry whose places stand taken apart is read of the walk of `Cpz5Decoder.DecryptEntry` over the digest of
the head and the key of the entry, and a payload that then begins with `PS2A` is walked of the window walk of
`UnpackLzss` behind the places of its own head, and one that begins with `PB3B` of the two places of its
tail. The places of a listing stand as they stand in the archive rather than as the count of the places the
walk of a payload unpacks to, which is the count the reference stands of as well.

## Deviations

* The key of an archive (`ArchiveKey`), which the reference reads out of a `start.ps3` beside the archive
  (`FindArchiveKey`) — a payload of the engine whose tables name every archive a game ships — is held to
  zero, which is the key of a stock build of the engine and of every layout below the seventh. An archive
  whose index stands of such a key is **refused** rather than read wrongly: the walk of it turns out nothing
  that stands, and the port names the scheme of it as the piece it does not carry.
* An archive whose head and index digest stand of this engine and whose walk of the index does not is
  detected, and the refusal of it stands at the reading of it (`UNSUPPORTED_FEATURE`) rather than at the
  detection, where the reference throws `UnknownEncryptionScheme` of its own.
* The walk of a directory of the index adds the key of the archive to its seed on the way in alone, and the
  walk of the entries of a directory stands of the same difference. Both places are kept as the reference
  writes them, so the two directions of each are each other's inverse for an archive whose key stands of
  nothing and part company for any other.
* A count of a record of nothing, a count of a record that runs past the index, a run of the rooms of a
  directory of no places, and a place of an entry that stands past the file are turned away, where the
  reference would read past the places of its own view.

## Tests

`tests/formats/cmvs-cpz-archive.test.ts` builds an archive of the fifth layout of the engine **through the
inverses of its own walks**: the three mixes of the index, the two directions of the walk of `Cpz5Decoder`
(both of them ported here), the walk of the places of an entry, and the head, whose sum is worked out in the
test rather than read off the port. The places of a `PS2A` payload are put behind the inverse of the walk of
its window, which the reference carries one way alone. The archive carries three entries over two
directories, of a room of the root and of a named room, of a run of places as they stand, of a run behind a
`PS2A` head and of a run of a picture of its own. The head, the sum of it, the digest of the index and a walk
of the index that does not stand are pinned beside it, of the refusal the last of them stands of as well.

The walks themselves stand in `packages/formats/src/cmvs/cpz5-index.ts`, held to a second transcription of
`ArcCPZ.cs` written apart from the port (a Python mirror, which is what caught the one place this port had
dropped — the addend of the first mix, whose absence the round trip alone would have caught as well).
