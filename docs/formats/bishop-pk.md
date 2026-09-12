# Bishop PK archive

## Reference and attribution

- GARBro reference: `ArcFormats/Bishop/ArcPK.cs`, class `PkOpener`
- GARBro tag: `PK/BISHOP`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`PK` archives start with the little-endian 32-bit signature `0x4B508E8C` (`8C 8E 50 4B`)
and an entry count at offset 4. The index starts at 0x0c and uses 0x230-byte records:

| Offset | Size | Meaning |
| --- | ---: | --- |
| 0x000 | 0x200 | null-terminated CP932 filename |
| 0x204 | 4 | absolute 32-bit offset |
| 0x208 | 4 | 32-bit size |
| 0x20c | 0x24 | unused |

GARbro reads the name with a 0x200-byte cap and then skips 0x204 bytes, so names are limited to
the first 0x200 bytes of the record.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| 0x230-byte records | Supported |
| CP932 filenames | Supported |
| Absolute offsets | Supported |
| Entry listing and extraction | Supported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
