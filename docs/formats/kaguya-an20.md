# KaGuYa AN20 animation resource

## Reference and attribution

- GARBro reference: `ArcFormats/Kaguya/ArcANM.cs`, classes `AnmOpenerBase` and `An20Opener`
- GARbro tag: `AN20/KAGUYA`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

This version drops the two-count table of its siblings and instead walks the same preamble that the version 21
format uses: a table count at 4, typed table records from 8, and then a counted name table of eight-byte
entries. Unlike version 21 it does not require a marker behind that preamble, and the reference reads the table
count without any sanity check, which the port mirrors because the walk bounds itself by the source size.

The frame count sits right behind the preamble, and the frames begin sixteen bytes after it. Their headers hold
width, height and depth at 8, 0x0C and 0x10, so a frame spans a 0x14-byte header plus depth times width times
height. Frames are named from the archive name and a two-digit index with their dimensions recorded as metadata,
the derived spans are checked where the reference does not, and extraction is verbatim.

The shared preamble walk lives in the version 21 module and is imported here, matching how both readers in the
GARbro file use the same table layout.

## Support

| Capability | Status |
| --- | --- |
| `AN20` signature detection | Supported |
| Shared typed preamble walk without a marker | Supported |
| Frame count behind the preamble with its gap | Supported |
| Frame headers with width, height and depth | Supported |
| Derived spans with bound checking | Supported as a hardening |
| Generated two-digit frame names and metadata | Supported |
| Verbatim extraction | Supported |
| Bitmap decoding | Not ported |
| Archive creation | Unsupported |

Synthetic fixtures cover two frames through the preamble walk.
