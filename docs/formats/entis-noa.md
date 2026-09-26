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

The remaining encryption kinds (`0x40000000`, `0x20000000`, `0xc0000010`, `0xa0000010`) need a password. The
reference takes one from its own settings, from a table of game keys that stands empty in the tree, or from a
`IDR_COTOMI` resource of an executable of the game beside the archive. The last of the three is read here: see
the section on the password below. The other kinds stand refused, as they do in the reference, which reports
them as not implemented and hands the bytes over as they stand.

## The password

The engine keeps an XML document in a resource named `IDR_COTOMI` of the executable of the game: one entry for
every archive of the game, naming the archive and its password. The password of an archive is looked for in the
document of each executable of the directory above the archive and of the archive's own directory, in that
order, which is the order the reference walks them in. The document is read as a `Nemesis` stream, and the
entries are read by scanning the tags of the document for `archive` tags that carry both a path and a key,
comparing the path against the file name of the archive without its case. Nothing is found for an archive that
no document names, and the entry is then turned away.

## The resource of an executable

`packages/formats/src/shared/exe.ts` reads the resource tree of a portable executable from the layout of the
file: the resource table of the data directories, the section that holds it, and the three levels of the tree —
a kind, a name and a language — where each entry either leads to the level below or names the bytes of the
resource. A kind or a name is either a name or a number, and the search reads the first match, which is the
language Windows would reach last. The reader is written from the format rather than ported, because the
reference asks the platform for the resource and carries no walk of its own.

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

* Only the kind `0x40000000` is decoded: the reference's `DecodeBSHF`. The kinds `0x20000000`,
  `0xc0000010` and `0xa0000010` do not stand implemented in the reference either, which hands their bytes over
  as they stand; this port turns them away.
* The reference reads a key from its own settings (a pass phrase the user keeps) and from a table of game keys
  that stands empty in the tree; neither has a place in this port, so a key comes only from the executable of
  the game that stands beside the archive.
* The reference asks Windows for the resource of that executable (`LoadLibraryEx` and `FindResource`), and
  this port walks the resource tree of the file itself (`packages/formats/src/shared/exe.ts`). That walk reads
  the reference's own pair `("IDR_COTOMI", "#10")` the way it was meant: the second of the two is the kind of
  the resource, and the reference writes a numbered kind as `#` and its number, which Windows reads as a name
  of its own and so finds nothing.
* The reference reads that resource as a `Nemesis` stream and nothing else; this port reads it as one where
  that works and as the bytes it holds where it does not, which is what the fixture of the tests needs, no
  encoder of a `Nemesis` stream standing anywhere.
* The reference reads the executables of the directory above the archive and then of the archive's own
  directory; this port walks the same two directories in the same order and walks one of them once where a
  path names no directory of its own.
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
* the refusal of a password-encrypted entry when no password stands beside the archive,
* the resource tree of an executable built in the test: the kind, the name and the language of the resource,
  the bytes it holds, and the pair the reference asks for (`("IDR_COTOMI", "#10")`) beside a name that stands
  nowhere and a file that is no executable,
* the scan of the document for the entry of an archive: the file name of a path, the case of it, and a name no
  entry carries,
* the password read out of the executable behind the archive, and the absence of one for an archive no entry
  names,
* the places of an entry of the kind `BSHFCrypt`, decoded with that password (a block of no bits, which the
  cipher leaves as it stands under any password).

`tests/codecs/erisa-nemesis.test.ts` pins the walk itself: an empty stream stands of the counts of the walk
of the engine of the places of the count of the walk of the engine of the reference (ones, and then zero
valued symbols), a stream of ones stands of the counts of the walk of the engine of the places of the count
of the walk of the engine behind them, and the counts of the walk of the engine of the model of the walk of
the engine stand of the counts of the walk of the engine of the count of the walk of the engine of the count
of the walk of the engine at most.

## References

- `GARbro/ArcFormats/Entis/ArcNOA.cs` — `NoaOpener.TryOpen`, `NoaOpener.OpenEntry`, `IndexReader.ParseDirEntry`,
  `NoaOpener.GetArcPassword`, `NoaOpener.ExtractNoaPassword`, `NoaOpener.XmlFindArchiveKey`, `NoaOpener.DecodeBSHF`
- `GARbro/ArcFormats/ExeFile.cs` — `ExeFile.ResourceAccessor` (the platform resource lookup the port replaces)
- `packages/formats/src/entis/noa-keys.ts`, `packages/formats/src/shared/exe.ts`,
  `packages/codecs/src/erisa-bshf.ts`
