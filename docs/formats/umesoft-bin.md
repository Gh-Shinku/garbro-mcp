# U-Me Soft BIN resources archive

## Reference and attribution

- GARBro reference: `Legacy/UMeSoft/ArcBIN.cs`, class `BinOpener`
- GARBro tag: `BIN/UME`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

There is no signature. The archive opens with a count word whose low half must be zero and whose high half holds the
record count plus one. Records start at 0x0C and are three words wide: an identifier that becomes a zero-padded
five-digit name, a payload offset in units of two kilobytes, and the stored size. Offsets are shifted left by eleven
bits with 32-bit wrap-around, as the reference's `uint` shift does, and every entry must pass the placement check.

After the index is read the reference probes each payload. One that carries an `ike` marker two bytes in is packed: three
size bytes at +10 declare the unpacked size and the thirteen-byte header is removed from both the offset and the stored
size. The size encoding is the reference's `DecodeSize (a, b, c) = b + ((c + (a >> 2 << 8)) << 8)`, so the high six bits
come first and the low byte sits in the middle of the triplet.

The payload signature is then used for typing. That probe happens fifteen bytes into the record, which for packed
payloads is two bytes past the header — a quirk of the reference that the port reproduces. Of the reference's typing,
only the explicit special cases are reproduced: Ogg and RIFF signatures are audio and anything whose low half spells
`BM` is a bitmap. GARbro's registry-wide signature lookup, which also reports ambiguous signatures as untyped, is not
reproduced.

## Extraction

Packed payloads are decoded with the shared Ike reader: a 16-bit little-endian bit window drives flag bits that select
between a literal byte and a back reference, back references come in a short two-byte form and a long form whose distance
is assembled from a chain of sign bits and whose length is coded in a ladder from three up to a literal byte plus
seventeen, and copies expand byte by byte into the output. A distance of -1 either ends the stream or is skipped.
Everything else is emitted verbatim. The decoder allocates the declared unpacked size outright, so the reported size is
exact; the reference's unchecked reads past the end of the stream or before the start of the output are reported as
invalid archives instead.

## Support

| Capability | Status |
| --- | --- |
| Packed count word with a zero low half | Supported |
| 0x0C records with five-digit names | Supported |
| Kibibyte-scaled payload offsets | Supported |
| `ike` marker probe with a three-byte unpacked size | Supported |
| Shared Ike LZ decoding | Supported |
| BMP, RIFF and OggS signature typing | Supported |
| Verbatim extraction | Supported |
| Entry placement validation | Supported |
| Registry-wide signature typing beyond the reference special cases | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover the size decoding, literal and short-back-reference decoding, stored entries with zero-padded
names, a packed entry, signature typing of a packed payload, a count word with a non-zero low half and an out-of-range
entry.
