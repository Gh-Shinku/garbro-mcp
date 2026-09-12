# Artemis MJA animation archive

## Reference and attribution

- GARBro reference: `ArcFormats/Artemis/ArcMJA.cs`, class `MjaOpener`
- GARBro tag: `MJA`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`MJA` files start with the ASCII signature `MJA0` and an entry count at offset 4. Records
follow from offset 8: each record is a 32-bit size followed by that many bytes of payload. The
count is only used for sanity checking; GARbro walks records until the end of the file.

Entries have no stored names. GARbro names them `<basename>#0000`, `#0001`, ... and appends the
extension of the resource signature found at the start of the payload. This port performs the same
naming but only resolves signatures of resources already implemented here (Ogg, RIFF/WAVE, PNG,
BMP); other payloads keep the bare `#NNNN` name.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Size-prefixed record walk | Supported |
| Generated names | Supported |
| Common signature extension inference | Supported |
| Entry listing and extraction | Supported |
| Full GARbro resource-catalog extension inference | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
