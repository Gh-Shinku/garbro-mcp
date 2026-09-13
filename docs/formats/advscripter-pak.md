# ADVScripter engine resource archives (PAK)

## Reference and attribution

- GARBro reference: `ArcFormats/AdvScripter/ArcPAK.cs`, class `PakOpener`
- GARBro tag: `PAK/MD002`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive is identified by the `MD002` signature and by a marker of `00V` at 0x21, which the reference checks
separately; every index record is then transformed according to a version digit.

## Header

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 5 | `MD002` signature |
| 0x1C | 4 | Header key, used by most versions |
| 0x20 | 1 | Version digit, from `1` to `9` |
| 0x21 | 3 | `00V` marker |
| 0x24 | 4 | Entry count |
| 0x28 | 0x30 × count | Index records |

## Index records

A record holds a 0x20-byte CP932 name, a packed flag at 0x20 and three 32-bit fields: the payload offset at
0x24, the unpacked size at 0x28 and the packed size at 0x2C. The name is decoded to its first NUL byte and listed
verbatim, since the reference is not hierarchical.

Every version applies its own combination of a key, a bit transform and a name decryption:

| Version | Key | Field transform | Name decryption | Payload mask |
| --- | --- | --- | --- | --- |
| 1 | none | none | no | no |
| 2 | `0xFFFFFFFF` | shift right by 1, 2, 3 | no | no |
| 3 | header | shift right by 1, 2, 3 | no | no |
| 4 | header | shift right by 1, 2, 3 | yes | no |
| 5 | none | none | no | yes |
| 6 | `0xFFFFFFFF` | shift right by 1, 2, 3 | no | yes |
| 7 | header | shift right by 1, 2, 3 | no | yes |
| 8 | header | shift right by 1, 2, 3 | yes | yes |
| 9 | header | rotate right by 17, 18, 19 | yes | no |

The key is exclusive-ored into each of the three fields **before** the transform, so the reader unmaskes and then
shifts or rotates. Name decryption exclusive-ors the first 28 bytes of the record — that is, most of the name
field, but not its last four bytes — with the key's four bytes taken cyclically.

## Extraction

Payloads are stored ranges. For versions 5 through 8 the stored bytes are first exclusive-ored with `0xFF`, and
a payload whose packed flag is set is then decoded as an LZSS stream with the default codec settings.

## Support

| Capability | Status |
| --- | --- |
| `MD002` signature and `00V` marker checks | Supported |
| Version digit range and entry count | Supported |
| 0x30-byte index records with name, packed flag, offset and both sizes | Supported |
| Verbatim record fields of versions 1 and 5 | Supported |
| All-ones key of versions 2 and 6 and header key of the other versions | Supported |
| Shift transform of versions 2 to 8 | Supported |
| Rotation transform of version 9 | Supported |
| Name decryption of versions 4, 8 and 9 | Supported |
| `0xFF` payload mask of versions 5 to 8 | Supported |
| LZSS payload decoding and placement checks | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover version 1 stored entries, a shifted and keyed version 3 archive, a version 2 archive
with the all-ones key, a version 9 archive with rotated fields and an encrypted name, packed payloads of versions
8 and 5, a missing marker, an out-of-range version digit, a payload outside the archive, and an insane entry
count.
