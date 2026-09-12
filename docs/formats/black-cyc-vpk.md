# Black Cyc VPK audio archive

## Reference and attribution

- GARBro reference: `ArcFormats/BlackCyc/ArcVPK.cs`, class `VpkOpener`
- GARBro tag: `VPK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`VPK` archives are detected by extension and keep their index in a sibling `.vtb` file whose
size must be a multiple of 0x0c. The record count is `vtbSize / 0x0c - 1`; each record holds
an eight-byte name (with `.vaw` appended) and a 32-bit offset at +8. Sizes come from the
neighbouring offsets in the main archive.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Companion `.vtb` index | Supported |
| Derived entry sizes | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
