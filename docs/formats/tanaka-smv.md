# Tanaka SMV animation resource

## Reference and attribution

- GARBro reference: `ArcFormats/Tanaka/ArcSMV.cs`, class `SmvOpener`
- GARBro tag: `SMV`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `SMV1` file repeats its own size at 4, which GARbro compares with the real file length, and stores
a frame count at 8. The first frame header begins at 0x40: its size field at 0x40 steps over the
animation header, and the depth field at 0x4e must be eight, so the header must cover that field.

Behind the header and a palette that GARbro always reads as 0x400 bytes come the frame records, each
holding a 32-bit offset and size. Frames are named `<archive>#<n padded to 2>`, the stored depth is
exposed as entry metadata, and the payloads are extracted raw.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| File size cross-check | Supported |
| Animation header and palette skipping | Supported |
| Depth validation | Supported |
| Frame records with offsets and sizes | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Frame decoding | Not applicable |
| Archive creation | Unsupported |

Synthetic fixtures cover the header walk, frame records, file size rejection, depth rejection, and
signature rejection.
