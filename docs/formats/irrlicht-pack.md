# Irrlicht PACK archive

## Reference and attribution

- GARBro reference: `ArcFormats/Irrlicht/ArcPACK.cs`, class `PackOpener`
- GARBro tag: `PACK/Irrlicht`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2017 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`PACK` files are detected by extension and contain a flat chain of 0x10a-byte record headers:

| Offset | Size | Meaning |
| --- | ---: | --- |
| 0x000 | 0x104 | null-terminated CP932 filename |
| 0x104 | 1 | separator |
| 0x105 | 4 | 32-bit size |
| 0x109 | 1 | separator |

Payloads follow each header immediately and the walk continues until the end of file. GARbro
requires at least one byte after the header, which this port keeps as a strict bound check.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Record-chain walk | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
