# TechnoBrain IPQ animation resource

## Reference and attribution

- GARBro reference: `ArcFormats/TechnoBrain/ArcIPQ.cs`, class `IpqOpener`
- GARBro reference: `ArcFormats/TechnoBrain/ImageIPF.cs`, class `IpfFormat` (header reader)
- GARBro tag: `IPQ`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An IPQ file is a `RIFF` container. The format string lives in the header field at offset 8 and must
read `IPQ fmt `, which deliberately overlaps the `fmt ` chunk marker at 0x0c: the trailing four
characters are the marker itself. The `fmt ` chunk size at 0x10 must be at least 0x24 bytes, the
palette flag sits at 0x18, and when it is set a `pal ` chunk of at least 0x24 bytes follows the
header. The data offset is wherever that walk ends.

Behind the IPF header an `anim` marker introduces a 32-bit index size and a frame count, followed by
one 32-bit offset per frame. Frames are named `<archive>#<n padded to 3>`; GARbro derives sizes
backwards from the end of the file, so the last frame runs to EOF. Frames are extracted raw.

## Support

| Capability | Status |
| --- | --- |
| RIFF and format string validation | Supported |
| `fmt ` chunk size validation | Supported |
| Optional `pal ` chunk skipping | Supported |
| `anim` index and frame offsets | Supported |
| Backwards size derivation | Supported |
| Generated frame names | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Frame decoding | Not applicable |
| Archive creation | Unsupported |

Synthetic fixtures cover the overlapping format string, the palette chunk variant, index parsing, and
format string rejection.
