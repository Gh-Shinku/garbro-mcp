# Clio PAC archive

## Reference and attribution

- GARBro reference: `Legacy/Clio/ArcPAC.cs`, class `PacOpener`
- GARBro tag: `PAC/CLIO`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`PAC` archives are detected by the `.pac` extension. A 32-bit entry count sits at offset 0 and
the index starts at 4. Records are 0x28 bytes with a null-terminated CP932 filename, a 32-bit
size at +0x20, and a 32-bit absolute offset at +0x24. Offsets must point past the index.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Size-before-offset records | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
