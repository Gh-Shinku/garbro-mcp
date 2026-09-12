# ransel BCD archive

## Reference and attribution

- GARBro reference: `Legacy/Ransel/ArcBCD.cs`, class `BcdOpener`
- GARBro tag: `BCD`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`BCD` archives start with the ASCII signature `BinaryCombineData` and keep their index in a
sibling `.bcl` text file. The listing starts with `[BinaryCombineData]`, the archive file name,
an ignored line, and repeating groups of `[name]`, offset, size, and an ignored line.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Companion `.bcl` text listing | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
