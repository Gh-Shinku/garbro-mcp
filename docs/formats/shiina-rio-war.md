# Shiina Rio engine resource archive of the count one hundred and ten (`shiina-rio-war`)

Reference: `ArcFormats/ShiinaRio/ArcWARC.cs`, class `WarOpener`, tag `WAR`, GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License. Two rows of the reference carry the name `WAR`:
this one and `ArcWARC1.0.cs` (class `War0Opener`, the head `WARC 1.0`), which this project ports beside it as
`shiina-rio-warc`.

## What the format is

```text
the word `WARC` at the head of the file
the count of the version of the engine at 4: `X.Y:<digit>`, the count being 100 + digit * 10
the place of the index at 8, of a count of the file exclusive-or'ed with 0xF182AD82
```

The index itself stands of a cipher of its own: **every word of it** exclusive-or'ed with the place of the
index. What stands behind that differs with the count of the version, and the versions of **one hundred and
ten and below** stand of no further walk at all - `Decoder.DoEncryption` answers at once for a count of the
version below one hundred and twenty:

```csharp
if (data_length < 3 || WarcVersion < 120)
    return;
```

so such an index stands of the one count alone (`Decoder.DecryptIndex` = `Decrypt` + `XorIndex`, and
`XorIndex` stands of the count of the version one hundred and seventy only for counts at and above it).

A record of the index is a name of `0x10` places (`EntryNameSize` of `EncryptionScheme.Warc110`) and, behind
it, the place of the file, the count of its places, the count of the places it unpacks to, the count of the
time of the file (eight places) and the flags of it, of `0x18` places - `0x28` over all. A file stands of the
listing where its name holds a place, where the first place of the name stands below `0x80` and where the
name has not been read before. `Decoder.GetMaxIndexLength` bounds the index at `(0x10 + 0x18) * 8192`
places.

The places of a file of the count one hundred and ten stand as they stand: the walks `UnpackYH1`, `UnpackYPK`
and `UnpackYLZ` that the word of the head of a file names are the reference's own and are not carried here.

## Deviations from the reference

* An archive of a count of the version **above one hundred and ten** stands of no walk of this port at all:
  `detect` answers `false` for it, where the reference answers with a scheme of the game or with nothing at
  all. That is the rule this project follows for a variant it does not know: it is not told, so another
  format may take the file.
* The count of the places of the index stands of the counts of the file of the archive here rather than of
  the whole of `MaxIndexLength` the reference allocates, which comes to the same walk, the places behind the
  index being read by neither the one nor the other.
* A file of the engine whose places reach past the end of the archive stands refused with the whole archive,
  as the reference's `CheckPlacement` refuses it.

## Verification

`tests/formats/shiina-rio-war.test.ts` (3 tests):

* the head: the count of the version of the file (one hundred and ten of the digit one, of no walk of the
  counts of two and of nought), the head of another word, and the first words of the cipher worked out **by
  hand** (`0x40` standing of `40 00 00 00` twice);
* the listing of an archive of two files: their names, the counts of their places, the counts they unpack to
  (and the flag of a file that stands packed), the counts of the time and the flags of them, the record of no
  name left out of the listing, and the places of a file handed over as they stand;
* the refusals: a head of no count of the engine, an index standing outside the file, a file of the engine
  standing past the end of the archive, and an index of fewer places than the counts of the reference.
