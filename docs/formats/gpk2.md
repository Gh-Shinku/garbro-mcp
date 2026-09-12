# GPK2 resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Gpk2/ArcGPK2.cs`, class `GpkOpener`
- GARBro tag: `GPK2`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`GPK2` archives start with the ASCII signature `GPK2` and a 32-bit index pointer at offset 4.
The pointed-to index begins with a 32-bit entry count followed by 0x88-byte records:

| Offset | Size | Meaning |
| --- | ---: | --- |
| 0x00 | 4 | absolute 32-bit offset |
| 0x04 | 4 | 32-bit size |
| 0x08 | 0x80 | null-terminated CP932 filename |

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Pointed-to index | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
