# Apple Pie ARC archive

## Reference and attribution

- GARBro reference: `Legacy/ApplePie/ArcARC.cs`, class `ArcOpener`
- GARBro tag: `ARC/ApplePie`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`ARC` archives start with the signature `41 52 43 10` (`ARC` plus 0x10), a 32-bit entry count
at offset 4, and a 32-bit index offset at 0x0c. Each 0x18-byte record holds a 0x10-byte CP932
filename, a 32-bit size at +0x10, and a 32-bit absolute offset at +0x14.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Pointed-to index | Supported |
| Size-before-offset records | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
