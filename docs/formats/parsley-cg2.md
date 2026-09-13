# Software House Parsley CG archive

## Reference and attribution

- GARBro reference: `ArcFormats/Software House Parsley/ArcCG2.cs`, class `CgV2Opener`
- GARBro tag: `CG/PARSLEY/2`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive is a file named `CG` that reserves a fixed 0x6000-byte index region. Records are 0x30
bytes: a 0x20-byte CP932 name, a data offset relative to the payload area, the image width and
height, and the stored size. The chain ends at the first record whose leading byte is zero, and
GARbro rejects blank names and out-of-range payloads.

The port exposes the stored dimensions and the eight-bit depth as entry metadata.

## Support

| Capability | Status |
| --- | --- |
| File name detection | Supported |
| Fixed 0x6000-byte index region | Supported |
| 0x30-byte records with zero sentinel | Supported |
| Image metadata (width, height, bpp) | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Image decoding | Not applicable |
| Archive creation | Unsupported |

Synthetic fixtures cover the index region, the zero sentinel, generated metadata, and file name
rejection.
