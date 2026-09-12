# Herb Soft PAK archive

## Reference and attribution

- GARBro reference: `Legacy/Herb/ArcPAK.cs`, class `PakOpener`
- GARBro tag: `PAK/HERB`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Herb Soft archives carry the tag `..` and a NUL at offset 0x40 and must be larger than
0x20000. The index starts at 0x80 and records are 0x40 bytes with a 0x30-byte CP932 filename,
a 32-bit offset at +0x30 relative to 0x20000, and a 32-bit size at +0x38. The walk stops at the
first zero byte or when the 0x20000-byte index area ends; zero-sized records are skipped.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| Fixed 0x20000 data base | Supported |
| Zero-sized record skipping | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
