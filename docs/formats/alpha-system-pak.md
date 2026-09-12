# Alpha System PAK archive

## Reference and attribution

- GARBro reference: `Legacy/AlphaSystem/ArcPAK.cs`, class `PakOpener`
- GARBro tag: `PAK/ALPHA`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A 32-bit entry count sits at offset 0 and a 32-bit first-offset field at 0x30 that must
equal `count * 0x30 + 4`. The index starts at 4 and uses 0x30-byte records with a 0x20-byte
CP932 filename, a 32-bit size at +0x24, and a 32-bit absolute offset at +0x2c.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| First-offset validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
