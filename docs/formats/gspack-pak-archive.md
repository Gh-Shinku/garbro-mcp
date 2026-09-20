# GsPack resource archive (`GsPack`)

Reference: GARbro `ArcFormats/GsPack/ArcGsPack.cs`, class `PakOpener` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License). Implemented as
`packages/formats/src/gs-pack/pak-archive.ts`, registered as `gspack-pak-archive`.

That source file holds three formats, and the gap inventory tracks each of them: this one, the `GsData`
archive of `DatOpener` and the `ScW` script of `GsScriptFormat`. Only the first is ported here.

## The marks

A file of this kind opens with one of `DataPack5`, `GsPack5` or `GsPack4` — and the first of the three is
**two bytes longer than the others**, which is a trap worth naming: a check that takes the length from one
mark and compares all of them over it will accept `DataPack5` and quietly reject the two `GsPack` ones,
which is exactly what the first version of this port did until a fixture of each mark was tested. The
reference declares two signature words, `Data` and `GsPa`, one per pair of marks.

## The header

| offset | field |
| --- | --- |
| 0x30 | the minor version |
| 0x32 | the major version, which decides the record size |
| 0x34 | the size of the packed index, or zero when it is stored |
| 0x38 | the flags |
| 0x3c | the record count |
| 0x40 | where the data starts |
| 0x44 | where the index starts |

A record is 0x48 bytes before major version 5 and 0x68 from there on; the index is the count times that
size. The count must be sane and the index size below 0xffffff, as the reference requires.

## The index

With an index size of zero, the index is read as it stands from the index offset, `count * recordSize`
bytes long. Otherwise that range holds a packed index, and the lowest flag bit says whether every byte of it
was first mixed with its own position. What comes out is unpacked with GARbro's `LzssReader`, whose ring
buffer is 0x1000 bytes with a fill of zero and a starting position of 0xfee, and whose control bits mark
literals when set — the same walk this project already carries in its codecs.

Each record is a name of at most 0x40 bytes, the offset of the data relative to the header's data offset at
0x40, and its size at 0x44. A record whose name is empty is walked past, as the reference does, and a record
that would leave the file rejects the archive.

## The records

The second flag bit says that every record was mixed with a key folded from **its own name**: taking each
character with its case folded away, the key is `key = key * 37 + (character | 0x20)` over the whole name,
and that one word is mixed into every whole word of the record. A record whose length is not a multiple of
four keeps its last bytes as they stand.

The type the reference gives a record comes from the name of the archive it read rather than from the
record: a name beginning `image` makes every record a picture and one beginning `voice` makes it a sound,
and otherwise the reference asks its own catalogue to look at the first word of the data. This port reports
the first two and leaves the records untyped in the third case, so nothing is guessed.

## Deviations from the reference

* Every read is bounded, a packed index that fails to unpack rejects the archive, and an index longer than
  64 MiB is refused rather than allocated; the reference lets its own stream throw.
* The catalogue lookup for an untyped archive is not ported, as above.
* The two other formats of this source file are not ported here; they have records of their own.

## Verification

Eight fixtures in `tests/formats/gs-pack-pak-archive.test.ts` cover the folded key against hand computed
values (0x61 for `a`, and `0x61 * 37 + 0x62` for `ab`, with `Ab` and `abc` folding to the same words), the
three marks with a rejection, the whole record size taken from the major version, a stored index with a
blank record, a packed index with and without its byte mixing, a record that would leave the file, a record
handed over as stored and one folded with its name, the trailing bytes of a record whose length is not a
whole number of words, and detection, listing and extraction through the registered format.
