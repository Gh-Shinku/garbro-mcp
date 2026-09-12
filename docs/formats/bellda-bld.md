# BELL-DA BLD archive

## Reference and attribution

- GARBro reference: `ArcFormats/BellDa/ArcDAT.cs`, class `BldOpener`
- GARBro tag: `DAT/BLD`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`BLD0` archives start with the ASCII signature `BLD0` and a version string at offset 4 that
must be one of `0`, `1`, `12`, or `3` after trimming the trailing `0x1a`. A 16-bit entry count
sits at 8 and a 32-bit index offset at 0x0a. Index records are 0x10 bytes with a 12-byte CP932
name and a 32-bit size at +0x0c; payloads are stored sequentially from offset 0x10.

## Support

| Capability | Status |
| --- | --- |
| Signature and version detection | Supported |
| CP932 filenames | Supported |
| Sequential payloads | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
