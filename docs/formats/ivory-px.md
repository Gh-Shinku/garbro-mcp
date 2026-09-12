# Ivory PX audio archive

## Reference and attribution

- GARBro reference: `ArcFormats/Ivory/ArcPX.cs`, class `PxOpener`
- GARBro tag: `PX/IVORY`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`PX` archives start with the ASCII signature `fPX ` and a 32-bit total size that must equal the
file size. From offset 8 the file is a chain of `cTRK` chunks: a 4-byte tag, a 32-bit chunk
size, and a 32-bit track number. Entries expose the whole chunk and are named
`<basename>#NNNN.trk` using the stored track number.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Total-size validation | Supported |
| CTRK chunk walk | Supported |
| Track-number naming | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
