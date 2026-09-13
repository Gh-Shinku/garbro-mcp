# Liar LWG multi-frame image

## Reference and attribution

- GARBro reference: `ArcFormats/Liar/ArcLWG.cs`, class `LwgOpener`
- GARBro tag: `LWG`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`LWG` files start with the 32-bit signature `0x0001474c`, a height at 4, a width at 8, a frame
count at 12, and a directory size at 20. The directory starts at 24 and holds variable-length
records: a 32-bit X, a 32-bit Y, a byte BPP, a 32-bit offset at +9 relative to the data area, a
32-bit size at +13, a byte name length at +17, and the name at +18. Names get a `.wcg`
extension. The data area starts after a 32-bit size word that follows the directory, and
entries must stay inside it.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Variable-length directory records | Supported |
| Data-area bounds validation | Supported |
| Generated WCG names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
