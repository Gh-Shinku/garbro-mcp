# Carriere resource archives

## Reference and attribution

- GARBro reference: `ArcFormats/Carriere/ArcARC.cs`, class `ArcOpener`
- GARBro tag: `ARC/CARRIERE`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior. The sibling
`ScenarioArcOpener` from the same reference file is documented in `carriere-scenario-arc.md`.

## Signature and index

The format opens with a two-word magic, both parts of which have to match:

| Offset | Size | Value |
| --- | --- | --- |
| 0x00 | 4 | `0x8F949B87` |
| 0x04 | 4 | `0x869E919A` |
| 0x08 | 4 | Entry count |

Records are a fixed 0x110 bytes from 0x0C:

| Field | Size | Meaning |
| --- | --- | --- |
| Name | 0x104 | CP932, everything before the first NUL |
| Offset | 4 | Absolute payload offset |
| Unpacked size | 4 | |
| Stored size | 4 | |

The name block is always skipped in full, so bytes behind the terminator are padding and not part of the
name. An entry is LZSS-packed when the two sizes differ, which is also the condition the reference uses for
`PackedEntry.IsPacked`.

## Payload handling

A packed entry runs through GARbro's default LZSS variant, an unpacked one is returned as it is. The
reference declares the record's unpacked size, so the listing reports it; the LZSS stream itself is decoded
to its own end.

## Support

| Capability | Status |
| --- | --- |
| Two-word magic, entry count and placement checks | Supported |
| Fixed 0x110-byte records with 0x104-byte name blocks | Supported |
| Packed flag from the two size fields | Supported |
| LZSS decoding of packed entries | Supported |
| Hierarchical path normalization | Supported |
| Extension-based entry typing | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover a stored and a packed entry, a name block with padding behind its terminator, a
name with backslash separators, a wrong second magic word, an insane entry count, and a payload outside the
archive.
