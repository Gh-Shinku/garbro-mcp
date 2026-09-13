# Musica engine SQZ animated frames

## Reference and attribution

- GARBro reference: `ArcFormats/Musica/ArcSQZ.cs`, class `SqzOpener`
- GARBro tag: `SQZ`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `SQZ1` archive stores the frame width at 8, the height at 0x0c, and a frame count at 0x10 that
GARbro doubles before walking the table. Records start at 0x14 and are eight bytes with the frame
offset and the stored size; frames are named `<archive>#<n padded to 4>`.

The port exposes the stored dimensions and the 32-bit depth as entry metadata, and extracts frames
raw. GARbro's image decoder reads a header inside each frame, which does not change the stored bytes.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Doubled frame count | Supported |
| Eight-byte frame records | Supported |
| Frame metadata (width, height, bpp) | Supported |
| Generated frame names | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Frame decoding | Not applicable |
| Archive creation | Unsupported |

Synthetic fixtures cover the frame table, generated names, signature rejection, and frame range
rejection.
