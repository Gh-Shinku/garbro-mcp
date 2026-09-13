# Ponytail BND resource archive

## Reference and attribution

- GARBro reference: `Legacy/Ponytail/ArcBND.cs`, class `BndOpener`
- GARBro tag: `BND/NMI`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `Bind` signature followed by ` ver.0` opens the file. The entry count is an int16 at 0x0D and the index starts at the
offset stored at 0x0F.

Every index record is 0x18 bytes:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 8 | Name, read up to its first zero byte and trimmed |
| 0x08 | 3 | Extension, read the same way |
| 0x0C | 4 | Stored size |
| 0x14 | 4 | Payload offset |

The entry name is `<name>.<extension>`, and both the size and the payload offset are placement-checked.

## Packed entries

A second pass probes entries whose name ends in `Z` for the `lz1_` marker at the payload start:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | `lz1_` marker |
| 0x04 | 1 | Real extension character |
| 0x05 | 4 | Unpacked size |

The extension character replaces the trailing `Z` — so an entry stored as `CG0001.Z` is listed as `CG0001.B` — and the
unpacked size becomes the entry's declared size. Extraction skips the nine-byte marker and decodes the rest with LZ1.

GARbro additionally skips entries whose catalog-derived type is an image. Under the 8.3 name limit that combination
cannot occur, because a name can only end in `Z` when its extension does too, so the port only implements the suffix
test.

## LZ1 decoding

A control byte is read whenever the eight-bit mask runs out, and the mask is tested from its least significant bit
upwards. A set bit means one literal byte; a clear bit means a match whose two bytes hold the distance in the high eleven
bits (plus one) and the length in the low five bits (plus three). Matches expand byte by byte, so they may overlap the
output position.

The reference returns a partially filled buffer when the stored stream ends early, so a missing control byte ends
decoding without error; a literal or match that runs past the stored bytes raises an invalid-archive error instead.

## Support

| Capability | Status |
| --- | --- |
| `Bind` signature with the version string | Supported |
| Entry count and index offset | Supported |
| 8.3 names with trimming | Supported |
| Stored size and payload offsets | Supported |
| `lz1_` marker probe | Supported |
| Unpacked size and recovered extension character | Supported |
| LZ1 literal and match decoding | Supported |
| Entry placement validation | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover 8.3 names, a packed entry whose extension is recovered, an entry ending in `Z` without a
marker, a foreign version string and an out-of-range payload.
