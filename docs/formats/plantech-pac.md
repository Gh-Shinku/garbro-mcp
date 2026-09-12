# PLANTECH PAC bitmap package

## Reference and attribution

- GARBro reference: `Legacy/PlanTech/ArcPAC.cs`, class `PacOpener`
- GARBro tag: `PAC/PLANTECH`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

PLANTECH packages wrap a single BMP bitmap without an index. Header layout:

| Offset | Size | Meaning |
| --- | ---: | --- |
| 0x00 | 4 | zero |
| 0x04 | 4 | mirrored BMP size |
| 0x08 | - | BMP file (`BM` signature) |

The value at 0x04 must equal the BMP header size field at 0x0a. GARbro exposes the whole BMP as
one entry named `<basename>.BMP`.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| Mirrored size validation | Supported |
| Single BMP extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
