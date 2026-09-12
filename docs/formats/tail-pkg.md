# Archive's PKG container

## Reference and attribution

- GARBro reference: `ArcFormats/Tail/ArcPKG.cs`, class `PkgOpener`
- GARBro tag: `PKG/ARCHIVE`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`PKG ` archives start with the ASCII signature `PKG ` and a 32-bit entry count at offset 4.
The index starts at 8 and uses 8-byte records with a 32-bit absolute offset and a 32-bit size.
Entries have no stored names: GARbro emits `<basename>#0000`, `#0001`, ... and infers resource
types from the payload signature, which this port does not replicate.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Generated entry names | Supported |
| Entry listing and extraction | Supported |
| Full GARbro resource-catalog type inference | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
