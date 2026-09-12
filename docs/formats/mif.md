# BasiL MIF archive

## Reference and attribution

- GARBro reference: `ArcFormats/Basil/ArcMIF.cs`, class `PakOpener`
- GARBro tag: `MIF`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2014 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`MIF` archives start with the bytes `MIF` and a NUL terminator. A 32-bit entry count
sits at offset 4 and the index begins at 8. Each 0x18-byte record stores a null-terminated CP932
filename, a 32-bit absolute offset, and a 32-bit size.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| CP932 filenames | Supported |
| Absolute offsets | Supported |
| Entry listing and extraction | Supported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
