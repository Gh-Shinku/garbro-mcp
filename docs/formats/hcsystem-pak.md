# hcsystem PAK resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/HCSystem/ArcPAK.cs`, class `PakOpener`
- GARBro tag: `PAK/HCSYSTEM`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive starts with the `PACK` signature, the record count at 0x04 and a flag byte at 0x08 that marks an index whose
bytes are nibble-rotated. The reference accepts two record layouts: a 0x2C-byte ASCII record with a 0x20-byte CP932 name
and a 0x4C-byte Unicode record with a 0x40-byte UTF-16LE name, both followed by the unpacked size, the stored size and
the payload offset.

A layout is only accepted when the first record's offset equals the end of the index (`0x0C + entrySize * count`). For
encrypted archives that stored word is nibble-rotated like the rest of the index, so the reference rotates it back
before comparing. A candidate that does not fit inside the file is skipped, matching the bounds-checked view the
reference reads through.

An entry is LZSS-packed when its stored size is non-zero; a zero stored size means the payload is stored verbatim with
the unpacked size as its extent, which is what the reference copies into `Size`.

## Extraction

Packed entries are decoded with GARbro's default LZSS stream and marked as having an inexact size, because the reference
decodes to the end of the stored stream. Everything else is emitted verbatim. Only the index is encrypted; payloads are
stored as-is.

## Support

| Capability | Status |
| --- | --- |
| `PACK` signature and count validation | Supported |
| 0x2C ASCII and 0x4C Unicode record layouts | Supported |
| First-offset index check | Supported |
| Nibble-rotated encrypted index | Supported |
| Header-field entry layout | Supported |
| Packed/unpacked size handling | Supported |
| LZSS extraction | Supported |
| Verbatim extraction | Supported |
| Entry placement validation | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the ASCII layout, the Unicode layout, packed entries, an encrypted index, a mismatched first
offset, an out-of-range entry and a foreign signature.
