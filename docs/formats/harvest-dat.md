# MyHarvest UNA archive

## Reference and attribution

- GARBro reference: `Legacy/Harvest/ArcDAT.cs`, class `DatOpener`
- GARBro tag: `DAT/UNA`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`UNA` archives start with the bytes `UNA` and a NUL, followed by the version tag `001` and a
NUL. A 32-bit entry count sits at offset 8. The index starts at 0x20 and uses 0x30-byte records
with a null-terminated CP932 filename, a 32-bit absolute offset at +0x20, and a 32-bit size at
+0x24.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Version tag validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
