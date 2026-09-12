# Tigerman Project PAC archive

## Reference and attribution

- GARBro reference: `Legacy/Tigerman/ArcPAC.cs`, class `PacOpener`
- GARBro tag: `PAC/TIGERMAN`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Tigerman archives start with a zero 32-bit word and a 32-bit entry count at offset 4. The
index starts at 0x14 and uses 0x18-byte records with a 0x10-byte CP932 filename, a 32-bit
offset at +0x10 relative to the end of the index, and a 32-bit size at +0x14.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| Base-relative offsets | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
