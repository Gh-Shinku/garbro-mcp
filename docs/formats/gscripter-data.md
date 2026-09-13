# GScripter DATA archive

## Reference and attribution

- GARBro reference: `ArcFormats/GScripter/ArcDATA.cs`, class `DataOpener`
- GARBro tag: `DAT/GScripter`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2018 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

GScripter archives keep their index in a sibling file named after the archive with `.info`
appended (`CG01.dat` uses `CG01.dat.info`). The index size must be a non-zero multiple of
0x28 and each record holds a 0x20-byte CP932 filename, a 32-bit offset at +0x20, and a 32-bit
size at +0x24. Archives whose name starts with `CG` are typed as images and `SOUND` archives
as audio.

## Support

| Capability | Status |
| --- | --- |
| Companion `.info` index | Supported |
| CP932 filenames | Supported |
| Resource type inference from the archive name | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
