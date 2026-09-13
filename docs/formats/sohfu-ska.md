# Sohfu SKA resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Sohfu/ArcSKA.cs`, class `SkaOpener`
- GARBro tag: `SKA/SOHFU`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive starts with the `IPF2` signature, followed by a record count at 0x04 and 0x18-byte index records at 0x08.
Each record holds a 0x10-byte name field, a payload offset and a stored size, and every entry must pass the reference's
placement check.

The name field packs two strings: the CP932 name up to the first NUL, then an optional CP932 extension. A non-empty
extension replaces the name's own extension the way `Path.ChangeExtension` does. A field with no NUL byte keeps all
0x10 bytes as the name.

Nothing in the index marks an entry as packed. The reference decides at extraction time by probing the stored data for
the `LS8B` marker, which introduces the declared unpacked size and an eight-byte header. The port performs that probe
while parsing the index — so listing and extraction agree — and drops the header from the stored extent.

## Extraction

`LS8B` payloads are decoded by the reference's private window decoder: a least-significant-bit-first control byte drives
a 0x1000-byte window whose position starts at 0xFFF, a clear bit emits one literal byte, and a set bit reads two bytes
that encode the distance in the high twelve bits and a length of three to eighteen in the low nibble. The copy reads one
byte behind the position it writes, so overlapping matches expand one byte at a time. A match that would run past the
declared unpacked size raises an invalid-archive error, matching the index-out-of-range failure the reference's
unchecked write would produce. Everything else is emitted verbatim.

## Support

| Capability | Status |
| --- | --- |
| `IPF2` signature | Supported |
| Record count and 0x18-byte records | Supported |
| Name with NUL plus CP932 extension field | Supported |
| Extension replacement | Supported |
| Full name fields without a terminator | Supported |
| `LS8B` packed marker with unpacked size | Supported |
| Sohfu window LZSS decoder | Supported |
| Verbatim extraction | Supported |
| Entry placement validation | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the decoder (a literal and an overlapping match), stored entries with an extension field, an
`LS8B` payload, a full name field, a foreign signature and an out-of-range entry.
