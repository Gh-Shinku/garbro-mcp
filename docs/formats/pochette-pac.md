# Pochette PAC resource archive

## Reference and attribution

- GARBro reference: `Legacy/Pochette/ArcPAC.cs`, class `PacOpener`
- GARBro tag: `PAC/IDX`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The `.pac` file holds only payloads; a sibling `.idx` file holds the index, which GARbro locates with
`Path.ChangeExtension`. The companion index must be a multiple of 0x10 bytes, and every 0x10-byte
record holds a one-byte name length, the name, the data offset at +8, and the size at +12. Names
start with `GDT` or `WAV` in the tested titles, which GARbro maps to images and audio.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Companion `.idx` index | Supported |
| Record size alignment | Supported |
| Name and range validation | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the companion index, missing-companion rejection, and index alignment
rejection.
