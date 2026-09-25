# Primel ADV System resource archive (`PCF`)

Format reference: GARbro `ArcFormats/Primel/ArcPCF.cs` (`PcfOpener`, `PcfArchive`, `PcfIndexReader`,
`PrimelScheme`, `PrimelSchemeV2`), GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## Head

| place | field |
| --- | --- |
| 0 | the mark `Pack` |
| 4 | the word `Code` |
| 0x08 | the count of the entries |
| 0x10 | the count of the places of the block of the entries (`i64`) |
| 0x28 | the place of the index within that block (`i64`) |
| 0x30 | the count of the places of the index (`u32`) |
| 0x38 | the flags of the index (`u32`) |
| 0x58 | the key of the index (eight places) |

The block of the entries stands at the **end** of the file, of the count of its places read from the head:
its first place is `the end of the file - the count at 0x10`, and both the index and the place of every
entry stand of that block rather than of the file.

## The index

The index is a run of records of `0x80` places, one per entry:

| place | field |
| --- | --- |
| 0 | the name, of a string of no more than 0x50 places |
| 0x50 | the place of the entry within the block (`i64`) |
| 0x58 | the count of the places the entry unpacks to (`u32`) |
| 0x60 | the count of the places of the entry as it stands (`u32`) |
| 0x68 | the flags of the entry (`u32`) |
| 0x78 | the key of the entry (eight places) |

An entry whose counts differ is packed, and the count it unpacks to is the count of the places the reader of
it turns out.

## The schemes

The index, and then the places of every entry, stand of one of **two schemes** that differ in the hash their
keys stand of alone: the older one of `Primel.SHA256`, the copy of the walk of `RFC 1321`'s successor whose
round is not the round of the standard, and the newer one of the SHA-256 of the standard. The reference
tries the older one first and stands of the newer one where the older one turns out no entry; the archive
then carries the scheme the index was read with, and the places of the entries stand of it as well.

A scheme spells a key of sixteen places out of the eight places of the head (or of a record) by folding the
thirty-two places of the hash of them onto themselves a place at a time, and a place of the chaining out of
the same walk over that key.

## The flags

The places of `0xF0000` of the flags name the cipher over a run, and the places of `0xFF` and of `0xF00` the
packed streams behind it:

| flags | cipher |
| --- | --- |
| `0x10000` | `Primel1Encyption` |
| `0x20000` | `Primel2Encyption` |
| `0x30000` | `Primel3Encyption` |
| `0x80000` | `RC6` (of the submission of the AES, of a chaining place of its input) |
| `0xA0000` | AES, of a **segment of one byte** and of a chaining place of the cipher text |

| flags | streams |
| --- | --- |
| `0xFF` not zero | the range walk of `RangePackedStream` |
| `0xF00` reads `0x400` | `RlePackedStream` and then `MtfPackedStream` |
| `0xF00` reads `0x700` | `LzssPackedStream` |

The streams of the engine stand in `packages/codecs/src/primel-streams.ts`, the ciphers in
`primel-cipher.ts`, the cipher of `RC6` in `rc6.ts`, the AES and its byte wise walk in `aes.ts`, and the two
hashes in `primel-sha256.ts` and `crypto` of the platform.

## Deviations

* A count of no entries, a block or an index that stands past the file, and a record whose places stand past
  the file are turned away, where the reference would read past the places of its own view.
* The walk of the table of the places of a byte of `MtfPackedStream` never stops of its own, and the
  reference stands of a limit behind it; the port hands the count of the places an entry unpacks to over
  where the entry stands packed, and the count of the places of the run itself where the flags of an index
  name that walk.
* The reference reads a run through `PaddingMode.Zeros` of the platform on the cipher of AES, which drops
  the zero places at the end of a run; the port leaves them where they stand, since the engine's own readers
  stop at the count of the places of an entry.

## Tests

`tests/formats/primel-pcf-archive.test.ts` builds the archives it reads, of the head of the reference, the
block of the entries and an index behind them: an archive whose places stand as they are (of its listing and
of the reading of two entries), an archive whose record names the cipher of AES (of the walk of AES worked
out in the test, the other way), and an archive whose index the head names the cipher of `RC6` for - of the
walk of `RC6` backwards, which stands of the block of the cipher over the chaining place. The head, a count
of no entries, an index past the file and a mark of another engine are pinned beside them.
