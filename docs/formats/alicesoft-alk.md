# AliceSoft ALK archive

## Reference and attribution

- GARBro reference: `ArcFormats/AliceSoft/ArcALK.cs`, class `AlkOpener`
- GARBro tag: `ALK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`ALK0` archives start with the ASCII signature `ALK0` and a 32-bit entry count at offset 4.
The index starts at 8 and uses 8-byte records with a 32-bit absolute offset and a 32-bit size.
Records with a zero size are skipped. Entries have no names: GARbro emits
`<basename>#NNNN` using the record index.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Zero-sized record skipping | Supported |
| Generated entry names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
