# RealLive OVK archive

## Reference and attribution

- GARBro reference: `ArcFormats/RealLive/ArcOVK.cs`, class `OvkOpener`
- GARBro tag: `OVK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`OVK` and `NWK` archives hold an audio library with a 32-bit record count at 0 and a flat index at
4. The record width depends on the extension: `.ovk` archives use 0x10-byte records and `.nwk`
archives use 0x0c-byte records. A record stores the 32-bit data size, the 32-bit data offset, and a
32-bit audio id; entries are named `<archive>#<id padded to 5>.ogg` or `.nwa` respectively.

GARbro requires the first payload to start immediately after the index and validates every entry
against the archive size.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| 0x10 and 0x0c record widths | Supported |
| Generated audio names with padded ids | Supported |
| First-offset validation | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover both record widths, name generation, extension rejection, and overlapping
payload rejection.
