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
reference. Packed entries carry `EncType.ERISACode` (`0x80000010`) and would need the `Nemesis` decoder of
the engine; the remaining encryption kinds need a password that the reference reads from a neighbouring
executable or from its own settings.

## Deviations

* Packed entries (`ERISACode`) and password-encrypted entries are listed but refused at extraction with
  `UNSUPPORTED_FEATURE`. The reference decodes the first through `ErisaNemesisStream` and the second through
  `DecodeBSHF` once it has a password; this port has neither.
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
* the refusals: a packed entry and a password-encrypted entry.

## References

- `GARbro/ArcFormats/Entis/ArcNOA.cs` — `NoaOpener.TryOpen`, `NoaOpener.OpenEntry`, `IndexReader.ParseDirEntry`
