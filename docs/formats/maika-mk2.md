# MAIKA MK2 resource archives

## Reference and attribution

- GARBro reference: `ArcFormats/Maika/ArcMK2.cs`, class `Mk2Opener`
- GARBro tag: `DAT/MK2`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior. `Mk2Opener` is the base of the
`DAT/MIK01` opener, so its payload handling is shared through `maika/mk2-pack.ts`.

## Signatures

Six archive ids mark the format, each followed by a zero byte at 0x04:

```text
MK2.0  BL2.0  SL1.0  LS2.0  AR2.0  MP2.0
```

## Header and index

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x08 | 2 | Base offset, added to every record's payload offset |
| 0x0A | 4 | Index size, which has to fit from the index offset |
| 0x0E | 4 | Index offset, which has to be inside the file |
| 0x12 | 4 | Entry count, sanity checked only |

The index is a run of group headers, six bytes each: a 32-bit pointer relative to the index start and a 16-bit record
count. When the count is positive, its records follow the whole group table sequentially:

| Field | Size | Meaning |
| --- | --- | --- |
| Payload offset | 4 | Relative to the base offset; the addition wraps like a 32-bit add |
| Stored size | 4 | |
| Name length | 1 | Zero rejects the archive |
| Name | length | CP932 |

Payloads have to sit **before the index**, because that is the bound the reference's placement check uses, and names are
read with a clamped read, so one that reaches past the end of the file is shortened rather than rejected. A group
without records does not end the walk by itself: the reference reads a 32-bit word at the group's resolved pointer and
stops only when that word is minus one, so a terminator points at such a word. The walk is also capped at 512 groups,
which is what stops an index that never terminates.

## Payload handling

The scramble scheme comes from the archive id: `AR2.0` and `USG01` use the larger scheme, everything else the default.

| Scheme | Scrambled prefix | Swaps |
| --- | --- | --- |
| Default | 14 bytes | 7 ↔ 11, 9 ↔ 12 |
| AR | 15 bytes | 7 ↔ 13, 9 ↔ 14 |

An entry is compressed when the reference's packed header probe accepts it: the first two bytes are one of the `C1`,
`D1`, `E1` or `F1` signatures, and the 32-bit inner size neither falls below the scheme's scrambled prefix nor reaches
past the end of the record. `E1` payloads have their stored prefix descrambled with the scheme's swap pairs; the result
then runs through GARbro's default LZSS variant to the end of the packed range, and, when the LZSS output starts with
`BPR01` or `BPR02`, through the matching codec. Any other marker is returned together with the rest of the decoded data.
Everything else is stored as it is.

Because the LZSS stream runs to the end of the packed range and the BPR codecs carry their own counts, a compressed
entry's output size is only known once it has been decoded; a listing reports the stored size and marks the size as
unknown.

## Support

| Capability | Status |
| --- | --- |
| Six archive id signatures | Supported |
| Header fields, index bounds and the entry count | Supported |
| Group headers, the 512 group cap and the minus one terminator | Supported |
| Variable-length records with byte name lengths | Supported |
| Payload offsets relative to the base offset | Supported |
| Placement against the index start | Supported |
| Packed header probe for `C1`, `D1`, `E1` and `F1` | Supported |
| Default and AR scramble schemes | Supported |
| LZSS decoding and `BPR01`/`BPR02` expansion | Supported |
| Extension-based entry typing | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover a two-entry archive, stored, LZSS and `E1` payloads, an `AR2.0` archive with the larger scheme,
a base offset, a walk that only the 512 group cap can stop, an unknown archive id, an insane entry count, an index that
reaches past the archive, an index offset past the archive, a record without a name, a payload that crosses the index,
and a file too small for its header.
