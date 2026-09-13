# 'GameSystem' engine resource archives (CMP)

## Reference and attribution

- GARBro reference: `ArcFormats/GameSystem/ArcCMP.cs`, class `CmpOpener`
- GARBro tag: `CMP`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

A CMP archive keeps its index at the **end** of the file, so the signature never appears in the head. The port
therefore registers no signature hints and gates detection on the two-word trailer.

## Trailer and index

| Offset | Size | Meaning |
| --- | --- | --- |
| size − 8 | 4 | Index offset |
| size − 4 | 4 | `PACK` signature (`0x4B434150`) |

Within eight bytes of the end there is nothing to open. The index offset must lie inside the file, and a 32-bit
size word there must be positive: it is the unpacked index length. The LZ stream follows the size word and runs
to the end of the file, because the reference does not store a packed length.

The reference also accepts an index whose signature is the plain `PACK` word exclusive-ored with a key from the
user's scheme. The game keys live in external scheme files, so only the unencrypted variant is implemented here.

## Index form

```
[unpacked size : u32]
[lz stream, decoded until the unpacked buffer is full]
```

The decoder has no end marker. A control byte whose top bit is set introduces a match: the control byte and the
following byte form a half-word whose low eleven bits are the distance minus one, and whose higher bits (masked
with `0x1E`) are the run length minus two. Otherwise the control byte counts the literal bytes that follow, minus
one. Matches copy byte by byte from `destination − distance − 1`, so overlapping runs repeat data; a match that
would reach before the start of the decoded index is an error.

## Index records

The decoded index opens with the first payload offset and continues with one record per entry:

```
[u8 name length] [u8 packed flag] [4 unused bytes] [UTF-16LE name] [u32 next payload offset]
```

A **zero name length ends the walk**, so any further bytes are ignored. The stored size of an entry is the gap
to the next record's offset, computed as an unsigned 32-bit difference, and every payload must lie before the
index.

Packed entries hold the unpacked size as the first word of their payload; the LZ stream then follows and is
decoded into a buffer of that length. The port resolves that size at list time, so a packed entry reports its
unpacked size with the stored size as its packed size, while stored entries report the gap.

Names are hierarchical: backslashes become forward slashes and the original name is kept as `rawPath`.

## Support

| Capability | Status |
| --- | --- |
| Trailer signature and index offset | Supported |
| Unpacked index size word and stream to the end of the file | Supported |
| LZ decoder with literal runs and matches, including overlapping copies | Supported |
| Record walk with a zero name length ending the list | Supported |
| UTF-16LE hierarchical names | Supported |
| Packed flag, per-entry unpacked size word and payload decoding | Supported |
| Placement checks against the index offset | Supported |
| Signature-keyed indexes from external scheme files | Unsupported |
| Archive creation | Unsupported |

One documented deviation: the reference propagates exceptions from a malformed index, which declines the format
at a higher level, and the port's detection treats those cases as "not this format" as well.

Synthetic fixtures cover stored and packed entries with a hierarchical name, an LZ match, a record list that
ends at a zero name length, a wrong trailer signature, a file too short for its trailer, an index offset outside
the file, a non-positive index size, a payload that reaches into the index, and a truncated LZ stream.
