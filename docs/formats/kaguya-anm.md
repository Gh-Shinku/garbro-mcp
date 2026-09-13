# KaGuYa AN00 animation resource

## Reference and attribution

- GARBro reference: `ArcFormats/Kaguya/ArcANM.cs`, classes `AnmOpenerBase` and `AnmOpener`
- GARbro tag: `ANM/KAGUYA`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The signature spells `AN00` and the frame list is reached through two counts: a word at 0x14 says how far a
four-byte-stride table extends, and the word behind that table is the real frame count, so the first count only
serves to locate the second. Frames follow it, and each begins a 0x10-byte header holding its width and height
at 8 and 0x0C.

This version is always thirty-two bits per pixel, so a frame's span is its header plus four times width times
height, and that product is the only way to find the next frame. The reference checks no bounds on the derived
spans while the port does, and neither version carries per-frame names: `AnmOpenerBase` builds them from the
archive name and a two-digit index, which the port reproduces along with the depth, width and height as
metadata. Frames are extracted verbatim, since turning them into bitmaps is an image concern.

## Support

| Capability | Status |
| --- | --- |
| `AN00` signature detection | Supported |
| Two-count frame table | Supported |
| Frame headers with width and height | Supported |
| Fixed thirty-two-bit pixels | Supported |
| Derived spans with bound checking | Supported as a hardening |
| Generated two-digit frame names and metadata | Supported |
| Verbatim extraction | Supported |
| Bitmap decoding | Not ported |
| Archive creation | Unsupported |

Synthetic fixtures cover two frames, a foreign signature, and a frame whose declared width leaves the file.
