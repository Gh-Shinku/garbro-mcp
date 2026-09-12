# Artel PFD archive

## Reference and attribution

- GARBro reference: `Legacy/Artel/ArcPFD.cs`, class `PfdOpener`
- GARBro tag: `PFD`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`PFD` archives have no magic signature. A 32-bit entry count sits at offset 0 and the index
starts at 4 with 0x20-byte records: a 0x15-byte base name, a three-byte extension, a 32-bit
offset at +0x18, and a 32-bit size at +0x1c. Offsets must point past the index; a non-empty
extension replaces the name extension.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| Separate extension field | Supported |
| Index-following offsets | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
