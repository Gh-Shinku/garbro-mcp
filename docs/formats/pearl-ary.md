# Pearl Soft ARY archive

## Reference and attribution

- GARBro reference: `Legacy/Pearl/ArcARY.cs`, class `AryOpener`
- GARBro tag: `ARY`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2018 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`ARY` archives store a 32-bit entry count at offset 0 and an offset table from offset 4. The
first table value must equal `count * 4 + 8` and the sentinel at `count * 4 + 4` must equal the
file size. Entries are named `<basename>#NNNN` and sized by neighbouring offsets.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| First-offset validation | Supported |
| Sentinel offset validation | Supported |
| Generated entry names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
