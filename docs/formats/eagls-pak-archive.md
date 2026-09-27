# EAGLS engine resource archive (`eagls-pak-archive`)

Reference: `ArcFormats/Eagls/ArcEAGLS.cs`, class `PakOpener`, tag `PAK/EAGLS`, GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## What the format is

An archive of this engine carries no index of its own. The index stands in a **companion file** of the same
name with the `.idx` extension, which the reference reaches through its file system, and every place of that
index stands of a cipher:

```text
seed   = the last four places of the index file, read as a 32 bit count of no sign
count  = a walk of the counts of the engine of the places of `rand` (`m_seed * 214013 + 2531011`, of the
         counts of the places of the file of it)
place  = the place of the file exclusive-or'ed with `IndexKey[count % 50]`
```

The index itself is then a list of records. How wide they are depends on how many places the index holds:
`entry_size = index.Length / 10000`, at most `40`; a name stands of `0x18` places and the places of an entry
of `0x10` where `entry_size` stands of `40`, and of `0x14` and eight places otherwise. The place of the file
of an entry stands of the count of the first entry as its own base (`entry.Offset = stored - first_offset`),
a name of the value nought ends the list, and `CheckPlacement` refuses the whole archive where an entry
reaches past the end of the file. A name of the extension `.dat` stands of a script of the engine.

An archive whose **first entry** stands of the name `.gr` is a picture archive, and the places of its
entries stand of a count of the engine that the first entry names (`DetectEncryptionScheme`). The reference
tries two counts of its own - `LehmerRandomGenerator` and `CRuntimeRandomGenerator` - seeding each of them
with the **last place of the file of the first entry**, standing of one count of the walk first, and asking
whether the two counts behind it turn the word of the places 1 and 2 of the entry into `BM`, little endian.
Where neither count stands of it, the reference throws `UnknownEncryptionScheme`.

`OpenEntry` then stands of `CgEncryption` over the files of the names `.dat` and `.gr` of such an archive:
the count is seeded from the last place of the file of the entry, the walk stands of the places of the entry
up to `0x174b` of them and of the last place of the entry at the end, and every place stands of
`EaglsKey[count % 12]`.

## The port

`packages/formats/src/eagls/pak-archive.ts`: the index cipher, the walk of the index of both shapes, the two
counts of the engine, the detection of the scheme of a picture archive, and the walk of `CgEncryption`. The
format is **companion based**: it detects an archive only where the companion index stands beside it and the
whole walk of it stands, and it stands last among the formats that claim the `.pak` extension.

## Deviations from the reference

* The two schemes the reference reaches **only through a question** - `EaglsEncryption` (the text of a script
  from place `3600`, every second place, of a count seeded from the last place of the file read as a place of
  a *sign*) and `AdvSysEncryption` (the text from place `136000`, every place, of the key `ADVSYS` cycled) -
  are **not carried as code**. The reference reaches them through `Query<EaglsOptions>`, i.e. through a
  question put to the person reading the file, whose default answer holds no scheme at all; with no answer
  the reference opens the archive as an ordinary listing and hands the entries over as they stand, which is
  what this port does. Their arithmetic stands written down here rather than carried as code no call of this
  project could reach.
* Where neither of the engine's two counts stands of the first entry of a picture archive, the reference
  **throws** `UnknownEncryptionScheme`; this port throws `UNSUPPORTED_FEATURE` with the same meaning. The
  reference's own `FIXME` note says the detection can answer wrongly, the key being short, and the port
  keeps that arithmetic as it stands rather than tightening it.
* The reference's `TryOpen` answers `null` for a file that does not stand of this engine; the port's
  `detect` answers `false` in the same places and its `read` throws `INVALID_ARCHIVE`.
* A picture of the engine stands of the places `BM` at **1 and 2** rather than at 0 and 1: the reference
  reads the word of the places 1 and 2 of the file of the entry (`(ReadInt32 (offset) >> 8) & 0xFFFF`) and
  compares it against `0x4D42`. The port mirrors that arithmetic as it stands, and the test pins it.

## Verification

`tests/formats/eagls-pak-archive.test.ts` (6 tests):

* the two counts of the engine, against counts that stand **outside this project**: `CRuntimeRandomGenerator`
  seeded with one stands of `41, 18467, 6334, 26500, 19169`, the counts of the places of `rand` of the counts
  of the places of the engine of the counts of the engine of the places of it; `LehmerRandomGenerator` seeded
  with one stands of `31, 182, 175, 153, 232, 229, 232, 166`, which stand of a **second implementation of
  the same arithmetic written apart of this project** (Schrage's method, of the counts of the reference);
* the name of the index key of the reference, and a round trip of the cipher over a whole index;
* the walk of the index of both shapes (a name of `0x14` places and one of `0x18`, the places of a picture
  and of a script, a script of the name `.dat`), through real companion files in a temporary directory;
* the picture archive: a picture of the engine whose places stand of `LehmerRandomGenerator`, detected of
  the scheme by the archive itself and read back to `BM` at the places 1 and 2;
* the first three places of the walk of `CgEncryption` **by hand**: the last place of the file stands at
  nought, the count of the engine stands of `38`, `7719` and `21238` (the counts of the places of `rand` of
  the count of the engine of the counts of the engine), `EAGLS_SYSTEM` of those places stands of `G`, `L` and
  `E`, and the places of the file stand of `05`, `4d` and `47`;
* the refusals: an index shorter than the counts of the reference, an index of no walk of this engine, a
  picture archive of no count of the engine, and a file of the name of the index itself.
