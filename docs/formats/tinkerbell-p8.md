# TinkerBell P8 archive

## Reference and attribution

- GARBro reference: `ArcFormats/Cyberworks/ArcP8.cs`, class `P8Opener`
- GARBro tag: `PAK/P8`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`PAK` files are detected by extension. A 32-bit entry count sits at offset 0 and the index
begins at 4. Records are 0x1c bytes: a null-terminated CP932 filename, a 32-bit size at +0x10, and
a 32-bit absolute offset at +0x18. Records with an empty name are skipped. GARbro additionally
requires the stored offset to be greater than the record position.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| 0x1c-byte records | Supported |
| Empty-name skipping | Supported |
| Entry listing and extraction | Supported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
