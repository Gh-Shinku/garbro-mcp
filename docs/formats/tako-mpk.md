# Studio Tako MPK resource archive

## Reference and attribution

- GARBro reference: `Legacy/Tako/ArcMPK.cs`, class `MpkOpener`
- GARBro tag: `MPK/HG`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The `HG-P` and `HG-W` signatures select the record layout: `HG-W` stores an offset and a size per
record from offset 8, while `HG-P` stores offsets only and GARbro derives sizes from the neighbouring
offsets, letting the last entry run to the end of the file. A record count sits at 4.

Entry names come from a companion `00.mpk` list in the same directory: the whole file is XORed with
0x0a and read as CP932 lines. Without that file GARbro falls back to `<archive>#<n padded to 4>`
names, and the list file itself is never treated as an archive.

## Support

| Capability | Status |
| --- | --- |
| Signature detection for both variants | Supported |
| Size-carrying and offset-only layouts | Supported |
| Derived sizes for the offset-only variant | Supported |
| Companion `00.mpk` name list | Supported |
| Generated name fallback | Supported |
| List file rejection | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover both variants, the companion list, the generated-name fallback, and list
file rejection.
