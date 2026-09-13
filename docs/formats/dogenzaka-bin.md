# Dogenzaka Lab BIN archives

## Reference and attribution

- GARBro reference: `ArcFormats/Dogenzaka/ArcBIN.cs`, classes `BinOpener` (`BIN/Dogenzaka`) and `GamedatOpener`
  (`BIN/Dogenzaka/2`)
- GARBro tags: `BIN/Dogenzaka`, `BIN/Dogenzaka/2`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

Neither layout has a signature, so both are recognized structurally and only for `bin` files: the toolkit tries them
for every file and each one's own checks decide.

## `BIN/Dogenzaka`

An outer table of offset/size pairs points at an inner header per entry, and the inner header points at the payload.

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | Entry count |
| 0x04 | 8 × count | Outer records: payload header offset, then a size |
| — | 12 × count | Inner headers: a positive word, the payload offset, the flagged size |

The outer offset has to sit behind the table, and its size feeds a placement check that has to pass. The inner header
then supplies the real values:

1. a word that must be positive;
2. the payload offset, relative to the inner header;
3. a size whose low thirty bits are the stored size and whose top two bits are the compression flag — a flag of two
   means the payload is stored, anything else means it is compressed.

The final range is placement-checked again. The reference records the stored size rather than an unpacked one because
compressed payloads go to a stream that decodes until its input ends; the unpacked size is not recorded anywhere, so
those entries are marked as having an unknown output size.

Entry names are `<archive>#<index>` with a five-digit index.

## `BIN/Dogenzaka/2`

A single word leads the table and is not an entry, so the arrangement is:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | Count, including the leading zero word |
| 0x04 | 4 | Always zero |
| 0x08 | 4 × (count - 1) | Cumulative payload ends, relative to the table end |
| 4 + 4 × count | — | Payloads |

The entry count is one less than the stored count, and the table has to fit inside the archive. A payload of zero
length or one that falls outside the archive rejects the file. Entry names are `<archive>#<index>` with a four-digit
index.

## Typing

Both layouts retype entries from their payload signature, which also appends an extension to the generated name. The
shared helper recognizes the Ogg, RIFF and bitmap signatures; the catalog-wide lookup the reference performs is not
reproduced, so an unknown signature leaves the name alone. The game data layout hands payloads out as stored, while the
first layout unpacks compressed ones with the default LZSS stream.

## Support

| Capability | Status |
| --- | --- |
| Structural detection of both layouts | Supported |
| Outer offset/size pairs and inner headers (`BIN/Dogenzaka`) | Supported |
| Two-bit compression flag and LZSS unpacking | Supported |
| Cumulative offsets and the leading zero word (`BIN/Dogenzaka/2`) | Supported |
| Zero-length and out-of-range rejection | Supported |
| Signature-based retyping for Ogg, RIFF and bitmap | Supported |
| Five-digit and four-digit entry numbering | Supported |
| Placement validation | Supported |
| Catalog-wide type lookup beyond those signatures | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover both layouts, packed and stored payloads, retyping, an offset inside the index, an inner header
without a positive word, a table that does not start at zero, a zero-length entry and an out-of-range table.
