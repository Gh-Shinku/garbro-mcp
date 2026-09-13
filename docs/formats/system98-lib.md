# System-98 engine resource archives (LIB)

## Reference and attribution

- GARBro reference: `Legacy/System98/ArcLIB.cs`, class `LibOpener`
- GARBro tag: `LIB/SYSTEM98`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior. The archive's index lives in
a sibling `.CAT` file, so detection needs the archive's path.

## Signature and companion file

`Lib0` marks the archive, and a sibling file with the archive's own name and a `.CAT` extension has to exist;
without it the format declines the file.

| CAT magic | Index location |
| --- | --- |
| `Cat0` | Plain, inside the **LIB** at 0x06 |
| `Cat1` | LZSS-packed, inside the **CAT** at 0x06 |

The CAT carries a 16-bit entry count at 0x04, and the index is `count × 0x16` bytes either way. Any other CAT
magic rejects the archive.

## Index records

| Field | Size | Meaning |
| --- | --- | --- |
| Name | 0x0C | CP932, first NUL, then trailing whitespace trimmed |
| Packed flag | 1 | Non-zero marks a packed payload |
| Stored size | 4 | Includes the packed payload's 10-byte prefix |
| Offset | 4 | Absolute |

An empty name is accepted, since the reference trims the field without checking it. The format is not
hierarchical, so names are kept verbatim.

## Payload handling

A packed payload begins with a 10-byte prefix whose 32-bit unpacked size sits at +6; the stream follows at
+10 and the record's stored size covers both. The reference reads that size while extracting, and the port
resolves it while listing.

The codec is a format-specific LZSS variant:

- control bits are read from the least significant bit up, with a new control byte every eight commands;
- a match reads two bytes that split into a 12-bit offset (`high << 4 | low >> 4`) and a length of
  `(low & 0xF) + 3`;
- the 0x1000-byte ring starts at position one, and copies may overlap;
- the loop stops as soon as the input runs dry at a command boundary, and the number of decoded bytes is
  returned to the caller.

That returned length matters in both callers. The index keeps its zero-filled tail, so a short decode leaves
records of zeros, and a packed payload is truncated to what the stream actually produced, which is why a
damaged stream yields a shorter entry rather than an error. A match that would write past the declared
output length throws, where the reference would run off the end of its array.

## Support

| Capability | Status |
| --- | --- |
| `Lib0` signature and the sibling CAT requirement | Supported |
| `Cat0` plain index inside the LIB | Supported |
| `Cat1` packed index inside the CAT | Supported |
| 16-bit entry count and 0x16-byte records | Supported |
| 12-byte names with trailing whitespace trimming | Supported |
| Packed flag, stored sizes and placement checks | Supported |
| 10-byte packed prefix with the unpacked size at +6 | Supported |
| Format-specific LZSS variant with LSB-first control bits | Supported |
| Overlapping copies through the 0x1000-byte ring | Supported |
| Short decodes returned as shorter entries | Supported |
| Extension-based entry typing | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover a plain index with a stored and a packed payload, a packed index in the CAT, a match
that copies from bytes it has just written, a name whose trailing spaces are trimmed, a missing companion
file, an unknown CAT magic, an insane entry count, a payload outside the archive, and a foreign LIB
signature.
