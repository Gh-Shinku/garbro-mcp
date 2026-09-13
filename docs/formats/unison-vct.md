# Unison Shift VCT resource archives

## Reference and attribution

- GARBro reference: `Legacy/Unison/ArcVCT.cs`, class `VctOpener`
- GARBro tag: `VCT`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

There is no signature; the leading byte count is what makes the layout recognizable.

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 1 | Count of three-byte records |
| 0x01 | 3 × count | Records the reference skips |
| 1 + 3 × count | 4 | Entry count |
| 1 + 3 × count + 4 | 0x20 × count | Entry records |

A zero record count, or an entry table that reaches past the archive, rejects the file. Records hold:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 0x14 | Name, CP932, trimmed at the end |
| 0x14 | 3 | Extension, appended as stored when it is not blank |
| 0x18 | 4 | Payload offset |
| 0x1C | 4 | Payload size |

Names are trimmed, extensions are not: an extension field holding `BMP` gives `NAME.BMP`, while one holding only spaces
gives `NAME`. A name that is blank after trimming rejects the file.

## Packed payloads

A payload is packed when it starts with `LZS\0`, which the port checks while listing so the declared size and the
extraction agree. Its header holds the signature, the unpacked size, a packed size the decoder ignores and the length of
a control byte array, followed by that array and the compressed data.

The codec walks the control array one bit per symbol, least significant bit first:

1. a set bit emits a literal byte, which also lands in a 0x1000-byte ring buffer;
2. a clear bit reads a sixteen bit word whose low twelve bits are a ring distance and whose top nibble plus two is the
   match length; copied bytes are read from and written back into the ring, so overlapping matches see their own output.

The reference writes with an unchecked destination cursor and would run past the declared output size, or read past the
payload, on a malformed stream; the port reports both as an invalid archive.

## Bitmap repair

An unpacked payload that starts with `BM` and declares thirty-two bits per pixel is repaired: every four byte pixel has
its outer channels exchanged and its alpha inverted, and the two palette words at 0x36 and 0x3E are exchanged when they
carry the exact values the reference looks for.

The reference walks pixels without checking that the last one is complete; the port leaves a trailing partial pixel
alone.

## Support

| Capability | Status |
| --- | --- |
| Structural detection through the leading byte count | Supported |
| Three-byte records, entry count and 0x20-byte records | Supported |
| Trimmed names and appended extensions | Supported |
| LZ payload detection, control array and ring matches | Supported |
| Bitmap channel swap and alpha repair | Supported |
| Path normalization and placement validation | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover trimmed names with and without extensions, a packed entry, an overlapping ring match, both
bitmap repairs, a truncated control array, a zero record count, an unnamed entry, an index past the archive and an
out-of-range payload.
