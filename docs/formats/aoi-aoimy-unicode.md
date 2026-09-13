# Aoi AOIMY unicode script archive

## Reference and attribution

- GARBro reference: `ArcFormats/Aoi/ArcBOX.cs`, class `AoiMyUnicodeOpener`
- GARbro tag: `AOIMY/UNICODE`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

This variant repeats the archive's own tag as UTF-16 in its first sixteen bytes, which is why its signature word
reads as the letters `A` and `O` with a null byte after each. The reference decodes those bytes back into the
string `AOIMY01` and compares it with the tag, and the port compares the same bytes directly.

The big-endian entry count then sits at 0x10 rather than 8, and records begin at 0x14 with a 0x28-byte stride: a
0x20-byte UTF-16 name field that ends at a double-null, then a big-endian offset and size. Payloads are keyed by
their absolute offsets through the same function as the sibling layout, which the port imports rather than
duplicating.

## Support

| Capability | Status |
| --- | --- |
| UTF-16 tag with the `AOIM` signature word | Supported |
| Count at 0x10 and big-endian fields | Supported |
| UTF-16 name field with a double-null terminator | Supported |
| Offset-derived byte key function | Supported |
| Entry placement validation | Supported |
| Keyed payload decryption | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover an entry with a UTF-16 name and an offset-keyed payload.
