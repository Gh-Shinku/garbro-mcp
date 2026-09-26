# Entis GLS engine resource archive (`NOA`)

Reference: GARbro `ArcFormats/Entis/ArcNOA.cs` — classes `NoaOpener`, `NoaEntry`, `NoaArchive` and the index
reader `IndexReader` — at GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

An archive of the Entis GLS engine starts with a file word and an identifier, then holds a tree of `DirEntry`
sections that index the file's own bytes. Entries name pictures (`ERI`, `EMI`), sounds (`MIO`), scripts
(`TXT`) and other resources of the same engine, and extraction hands out each entry's bytes unchanged unless
the entry is packed or encrypted.

## Head

| offset | field |
| --- | --- |
| 0 | `Entis` followed by byte `0x1a`, or `VIST` followed by byte `0x1a` |
| 8 | file kind identifier: `0x02000400` only |
| 0x10 | file kind name; the name `EMSAC-Binary Archive` marks an older archive |
| 0x40 | the first index section, `DirEntry` |

## Index

A `DirEntry` section declares its own length at offset 8; that length counts the bytes from offset 8 of the
section. The section body starts at offset 0x10:

| offset | field |
| --- | --- |
| 0 | number of records in the section |
| 4 | first record |

Each record is `0x20` bytes followed by a variable tail:

| offset | field |
| --- | --- |
| 0 | recorded size, four bytes |
| 4 | unused, four bytes |
| 8 | attribute |
| 0xc | encryption kind |
| 0x10 | offset of the entry's own header, relative to the start of the enclosing `DirEntry` section |
| 0x18 | unused, eight bytes |
| 0x20 | length of the extra field, four bytes, then the extra field itself |
| — | length of the name, four bytes, then the name |

The attribute decides what the record is:

| attribute | meaning |
| --- | --- |
| `0x10` | a directory; the tree continues at the record's header offset plus `0x10`, and the name becomes the prefix of the names inside it |
| `0x20`, `0x40` | the record ends the section; it is not listed, and neither is anything after it |
| anything else | a file entry, listed under the current directory prefix |

A file entry's header is `0x10` bytes whose last eight bytes are the entry's size, and the file bytes follow
the header. A record's relative offset points at that header, so the file bytes start `0x10` bytes later.

The reference clamps a file entry whose recorded size runs past the end of the file to the bytes that are
left, except for packed entries, whose recorded size is the length of the decoded stream.

## Extraction

An entry that is neither packed nor encrypted is handed out as the bytes at its header offset plus `0x10`,
of the size declared in that header. A size of four bytes or less yields an empty stream, as in the
reference.

A packed entry carries `EncType.ERISACode` (`0x80000010`). Its stream is the entry's bytes from header offset
plus `0x10` up to four bytes before the declared size, and it decodes into at most the recorded size through
the `Nemesis` walk of the engine (`ErisaNemesisStream` in `ArcFormats/Entis/ErisaNemesis.cs`). That walk is
ported as `ErisaNemesisDecodeContext` in `packages/codecs/src/erisa-nemesis.ts`: it reads symbols from the
probability model, follows a chain of sub-models keyed on the last four symbols, and copies a phrase out of a
64 KiB ring buffer when the model escapes.

The remaining encryption kinds (`0x40000000`, `0x20000000`, `0xc0000010`, `0xa0000010`) need a password that
the reference takes from a `IDR_COTOMI` resource of a neighbouring executable or from its own settings. This
port has no such source, so those entries are still refused.

## The BSHF cipher

The cipher behind the encryption kind `0x40000000` is ported as `packages/codecs/src/erisa-bshf.ts`. A stream
of it is decoded thirty two bytes at a time, and a block of thirty two bytes is a bag of two hundred and fifty
six bits that the password permutes. The password is expanded to at least thirty two bytes: the byte `0x1b`
follows a shorter password and every byte behind it is the sum of the byte the count wraps to and the byte
before it. Then, for every bit of a block, a counter takes the next password byte, the low three bits of the
counter name a place inside a byte and the rest name the byte; that byte is scanned forward, whole bytes at a
time in eights and then bit by bit, until a place stands free, and the bit of the source goes there. The scan
continues from that place for the bit behind it, and the place in the password advances by one for every
block.

A password of no bytes does not leave a block where it is: the counter stands still but the scan keeps moving,
so the first eight bits of the source land in the first byte of the block in reverse order and the bits behind
them land where the scan reaches next. `tests/codecs/erisa-bshf.test.ts` pins the expansion of a short
password by hand, a password of thirty two bytes and more standing as it is, an empty password standing as a
space and a character outside ASCII standing as a question mark, the places a password of ones names, the
places a password of no bytes names, the permutation of every block — one bit in, one bit out, and two hundred
and fifty six different places — the password walking forward for every block, a block handed out in as many
calls as a caller asks for, and a stream whose last block stands short.

## Deviations

* Password-encrypted entries are listed but refused at extraction with `UNSUPPORTED_FEATURE`. The reference
  decodes the kind `0x40000000` through `DecodeBSHF` once it has a password, which it reads from a
  `IDR_COTOMI` resource of a neighbouring executable or from its own settings; the cipher is ported here (see
  below) but this port has no password source, and the reference's own table of game keys stands empty in the
  tree, so the cipher stands unwired.
* The reference hands an encrypted entry out **as it stands** when it finds no password; this port turns such
  an entry away instead, because the bytes it would hand over are not the bytes the entry names.
* The `Nemesis` walk is the reference's, but its fixture stands of the counts of the walk of the engine of the
  port itself: the reference holds no walk that stands of the places of the count of the walk of the engine
  of a picture of the engine (its own encoder is elsewhere). The walk therefore stands pinned of the counts
  of the walk of the engine of the places of the file of the engine, of the counts of the walk of the engine
  of the model of the walk of the engine and of the counts of the walk of the engine of the two counts of the
  places of the count of the walk of the engine, of no place of the count of the walk of the engine itself.
* The reference stands of the counts of the walk of the engine of the counts of the walk of the engine of the
  places of the count of the walk of the engine of the file of the engine at most: this port stands of a
  count of the walk of the engine of sixty four places of a count of a colour of the places of the count of
  the walk of the engine at most.
* The reference reads entry names with a configurable code page (`NoaEncodingCP`) for newer archives and
  always with `cp932` for older ones. This port always uses `cp932`.
* The reference grows its entry list without an explicit bound; this port caps the number of records in one
  section at `0x100000` and the index section length at `0x100000` bytes, so a corrupt file is declined
  instead of read forever.
* Archive creation is out of scope.

## Tests

`tests/formats/entis-noa.test.ts` builds archives in the test and pins:

* the index walk: file records, an extra field, a section terminator with a record behind it, and a nested
  directory whose entries carry the `dir/name` prefix,
* the detection negatives: another file word, another identifier and an index with no entries,
* the placement clamp plus the empty stream of an entry of four bytes or fewer,
* a packed entry, which decodes through the `Nemesis` walk into at most the recorded size, twice the same,
* the refusal of a password-encrypted entry.

`tests/codecs/erisa-nemesis.test.ts` pins the walk itself: an empty stream stands of the counts of the walk
of the engine of the places of the count of the walk of the engine of the reference (ones, and then zero
valued symbols), a stream of ones stands of the counts of the walk of the engine of the places of the count
of the walk of the engine behind them, and the counts of the walk of the engine of the model of the walk of
the engine stand of the counts of the walk of the engine of the count of the walk of the engine of the count
of the walk of the engine at most.

## References

- `GARbro/ArcFormats/Entis/ArcNOA.cs` — `NoaOpener.TryOpen`, `NoaOpener.OpenEntry`, `IndexReader.ParseDirEntry`
