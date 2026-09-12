# Brownie NAF archive

## Reference and attribution

- GARBro reference: `Legacy/Brownie/ArcNAF.cs`, class `NafOpener`
- GARBro tag: `NAF`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`NAF` archives start with the ASCII signature `1.BROWNIE`, a 32-bit entry count at 0x30, and
a 32-bit index offset at 0x34. Each 0x20-byte record holds a 0x10-byte base name, a four-byte
extension field, a 32-bit offset at +0x14, and a 32-bit size at +0x18. GARbro replaces the
name extension with the separate extension field.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Separate extension field | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
