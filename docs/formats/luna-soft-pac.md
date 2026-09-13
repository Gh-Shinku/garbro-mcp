# LunaSoft PAC archive

## Reference and attribution

- GARBro reference: `ArcFormats/LunaSoft/ArcPAC.cs`, class `PacOpener`
- GARBro tag: `PAC/LUNA`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The signature is the two-byte shift-jis word ぱく. The entry count sits at 4 and a base offset at 8,
which every record offset is added to. The index starts at 0x10.

GARbro supports two record layouts and tries them in order. A record holds the name at its start, the
data offset at 0x100, and then a size word followed by the name length: 32-bit offsets put the size at
0x104, 64-bit offsets at 0x108, so the record measures 0x10C or 0x110 bytes. The name length must be
non-zero and at most 0x100, and the port keeps the reference's ordering, including the consequence that
a file which satisfies the narrower interpretation is never read as the wider one. Payloads are stored
verbatim.

## Support

| Capability | Status |
| --- | --- |
| Shift-jis signature validation | Supported |
| Entry count validation | Supported |
| Base offset application | Supported |
| 32-bit offset layout | Supported |
| 64-bit offset layout fallback | Supported |
| Name length validation | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the 32-bit layout, the 64-bit fallback, the base offset, and name length
rejection.
