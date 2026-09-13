# ExHIBIT engine audio resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/ExHibit/ArcGRP.cs`, class `GrpOpener`
- GARbro tag: `GRP/EXHIBIT`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Only files named `res<digits>.grp` are handled, and a file beginning with `AiFS` is rejected because that marker
belongs to the table of contents rather than to an archive.

The table is a *sibling* file found by rewriting the archive's own digits: the reference starts one below the
archive's number, formats the candidate with four digits, and probes that name. A candidate that does not exist
**ends the search immediately** rather than being skipped, so the numbered files between an archive and its table
must form a contiguous run; a candidate that exists but does not begin with `AiFS` is passed over and the number
decrements again. The reference number by which the archive is addressed inside the table rises by one for each
step of that walk.

Inside the table a resource count sits at 0x0C and must be at least that reference number, and the blocks that
follow each begin at a 0x10-byte header. A block is this archive's when its first word equals the reference
number — or, when that first word is exactly `0x01000000`, when the word *behind* it does, which shifts the whole
header by four bytes. Blocks belonging to other archives are skipped using their own record count.

The matching block then holds a start index at 4 and a record count at 0x0C. Each eight-byte record gives a data
offset and a size, and a record whose size is zero is skipped entirely rather than becoming an empty entry.
Entries are named from the start index with five digits and an `.ogg` extension, are classified as audio, and are
checked against the *archive's* length rather than the table's. Payloads are stored verbatim.

## Support

| Capability | Status |
| --- | --- |
| `res<digits>.grp` name pattern and `AiFS` rejection | Supported |
| Sibling table search by rewriting the digits | Supported |
| Contiguous-run requirement and rising reference number | Supported |
| Resource count and reference-number check | Supported |
| Blocks with the marker word and its four-byte shift | Supported |
| Skipping blocks of other archives | Supported |
| Start index and record walk with zero-size skipping | Supported |
| Placement validation against the archive | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a table lookup, a block behind the marker word, a skipped foreign block, a zero-size
record, a missing table, and a name that does not match the pattern. Two fixture bugs were needed: the marker
word shifts the header and therefore the record block by four bytes, and the fixture's own table size had to
account for that shift.
