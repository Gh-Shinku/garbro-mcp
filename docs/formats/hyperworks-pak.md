# HyperWorks PACK archive

## Reference and attribution

- GARBro reference: `Legacy/HyperWorks/ArcPAK.cs`, class `PakOpener`
- GARBro tag: `PAK/ACE`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`PACK` archives start with the ASCII signature `PACK` and a 32-bit index size at offset 4
that must be a positive multiple of 0x18 and smaller than the file. The index starts at 8 and
each record holds a 32-bit offset, a 32-bit size, a one-byte name length (at most 15), and the
name bytes. The index/size layout matches the CDPA variant; the record differs.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Declared index size | Supported |
| Byte-length names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
