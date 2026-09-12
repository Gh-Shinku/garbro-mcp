# Software House Parsley PAC archive

## Reference and attribution

- GARBro reference: `ArcFormats/Software House Parsley/ArcPAC.cs`, class `PacOpener`
- GARBro tag: `PAC/PARSLEY`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`PAC` archives start with the ASCII signature `PAC0` and a 32-bit entry count at offset 4.
The index begins at 8 and uses 0x28-byte records with a null-terminated CP932 filename, a 32-bit
absolute offset, and a 32-bit size.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| CP932 filenames | Supported |
| Absolute offsets | Supported |
| Entry listing and extraction | Supported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
