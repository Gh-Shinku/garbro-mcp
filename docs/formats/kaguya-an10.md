# KaGuYa AN10 animation resource

## Reference and attribution

- GARBro reference: `ArcFormats/Kaguya/ArcANM.cs`, classes `AnmOpenerBase` and `An10Opener`
- GARbro tag: `AN10/KAGUYA`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

This version shares the two-count frame table of its 00 sibling — a word at 0x14 locating a four-byte-stride
table, and the real frame count behind it — but its frames begin a 0x14-byte header because a channel word sits
at 0x10. A frame's span is therefore its header plus channels times width times height, so the pixel depth is
read per frame rather than fixed at thirty-two bits.

Frames are named from the archive name and a two-digit index, with depth, width and height recorded as metadata,
and the port checks the derived spans while the reference does not. Extraction is verbatim; bitmap decoding is
out of scope.

## Support

| Capability | Status |
| --- | --- |
| `AN10` signature detection | Supported |
| Two-count frame table | Supported |
| Frame headers with a channel word | Supported |
| Derived spans with bound checking | Supported as a hardening |
| Generated two-digit frame names and metadata | Supported |
| Verbatim extraction | Supported |
| Bitmap decoding | Not ported |
| Archive creation | Unsupported |

Synthetic fixtures cover a frame with a channel word.
