# Airyu CHR resource archive

## Reference and attribution

- GARBro reference: `Legacy/Airyu/ArcCHR.cs`, class `ChrOpener`
- GARBro tag: `CHR/AIRYU`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `.chr` file carries no index. GARbro probes three raw image sizes in order — 0x96000, 0x4b000, and
0x19000 — and accepts the first one that divides the file size into a sane record count without a
remainder. Entries are named after their position, padded to five digits, and the payload of each one
is a fixed-size raw image.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Image size probing | Supported |
| Exact multiple requirement | Supported |
| Generated entry names | Supported |
| Entry listing and extraction | Supported |
| Pixel decoding | Not applicable |
| Archive creation | Unsupported |

Synthetic fixtures cover both image sizes, generated names, size rejection, and extension rejection.
