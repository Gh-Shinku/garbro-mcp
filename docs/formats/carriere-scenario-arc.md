# Carriere scripts archives

## Reference and attribution

- GARBro reference: `ArcFormats/Carriere/ArcARC.cs`, class `ScenarioArcOpener`
- GARBro tag: `ARC/~ARCHIVE`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior. The sibling `ArcOpener`
from the same reference file is documented in `carriere-arc.md`; both formats share the 0x104-byte name
block.

## Signature and index

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | `0xB7BCADBE`, the complement encoding of `~ARCHIVE` |
| 0x04 | 4 | `0xFFBAA9B6` |
| 0x08 | 12 | A data stream header for the index |

Both magic words have to match. The index is itself stored as a **data stream**, which is the format's one
recurring structure:

| Field | Size | Meaning |
| --- | --- | --- |
| Stored size | 4 | The whole block, header included |
| Flags | 4 | Bit 0 exclusive-ors with 0xFF, bit 1 runs LZSS |
| Unpacked size | 4 | Declared; the index header's value is unused |
| Payload | size − 12 | |

Payloads start behind the entire index block, at `8 + stored size`. The decoded index holds a 32-bit entry
count followed by fixed records:

| Field | Size | Meaning |
| --- | --- | --- |
| Name | 0x104 | CP932, everything before the first NUL |
| Offset | 4 | Relative to the payload area |
| Stored size | 4 | Used for the placement check |

## Payload handling

Every entry starts with its own data stream header, which is what extraction decodes. Flag 1 exclusive-ors
the payload with 0xFF and flag 2 then runs GARbro's default LZSS variant over the result, so the
exclusive-or comes first. The listing resolves each entry's header while parsing the index, so a listing
reports the declared unpacked size, the stored payload size, and the flags.

The reference marks an entry as packed during extraction rather than listing, because its `OpenEntry` fixes
up `IsPacked` after reading the header. The port resolves the same information at list time, which is
observationally equivalent.

## Support

| Capability | Status |
| --- | --- |
| Two-word magic and the data stream header layout | Supported |
| Exclusive-or and LZSS flags for the index and for every entry | Supported |
| Fixed 0x104-byte name blocks and relative payload offsets | Supported |
| Placement checks from both the record and the stream header | Supported |
| Hierarchical path normalization | Supported |
| Extension-based entry typing | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover stored, exclusive-ored, LZSS-packed and combined entries, an LZSS-packed index, a
wrong second magic word, an insane entry count, an index that reaches past the archive, and a data stream
that is too short for its header.
