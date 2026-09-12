# Akatombo X archive

## Reference and attribution

- GARBro reference: `Legacy/Akatombo/ArcX.cs`, class `XOpener`
- GARBro tag: `X/AKATOMBO`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`X` archives store a 16-bit entry count at offset 0 and a 32-bit offset table from offset 2.
The first offset must equal `count * 4 + 6`, offsets must be monotonic, and the final offset
must equal the file size. Entries are named `<basename>#NNNN`.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| Monotonic offset table | Supported |
| Generated entry names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
