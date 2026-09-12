# Leaf TEX textures archive

## Reference and attribution

- GARBro reference: `ArcFormats/Leaf/ArcTEX.cs`, class `TexOpener`
- GARBro tag: `TEX/LEAF`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`TEX` archives start with the ASCII signature `TEX ` followed by the tag `PACK0.02` at offset
4. A 32-bit entry count sits at offset 12, the index starts at 0x20, and each 0x28-byte record
holds a null-terminated CP932 filename plus a 32-bit offset at +0x20 and a 32-bit size at +0x24.
Stored offsets are relative to the end of the index.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Base-relative offsets | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
