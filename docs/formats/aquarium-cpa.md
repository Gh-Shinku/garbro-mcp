# Aquarium CPA archive

## Reference and attribution

- GARBro reference: `Legacy/Aquarium/ArcCPA.cs`, class `PakOpener`
- GARBro tag: `CPA`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`CPA` archives start with the ASCII signature `CPA` and a NUL byte. A 32-bit data offset sits
at offset 8 and a 32-bit slot count at offset 12. The index starts at 0x20 and uses 0x20-byte
records; a zero first byte marks an inactive slot that is skipped. Active records hold a
0x10-byte CP932 filename, a 32-bit offset at +0x10 relative to the data offset, and a 32-bit
size at +0x14.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Inactive slot skipping | Supported |
| Base-relative offsets | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
