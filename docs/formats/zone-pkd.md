# Zone PKD archive

## Reference and attribution

- GARBro reference: `Legacy/Zone/ArcPKD.cs`, class `PkdOpener`
- GARBro tag: `PKD/ZONE`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`PKD` archives are detected by the `.pkd` extension and a leading 32-bit value of 1. A 32-bit
entry count sits at offset 4, a 32-bit data offset at 0x0c, and the index at 0x10. Records are
0x2c bytes with a null-terminated CP932 filename, a 32-bit offset at +0x20 relative to the data
offset, and a 32-bit size at +0x24.

## Support

| Capability | Status |
| --- | --- |
| Extension and marker detection | Supported |
| Base-relative offsets | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
