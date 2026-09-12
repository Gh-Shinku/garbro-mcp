# For/Ucom UK archive

## Reference and attribution

- GARBro reference: `ArcFormats/Ucom/ArcUK.cs`, class `UkOpener`
- GARBro tag: `UK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`UK` archives start with the ASCII bytes `UK` and a 16-bit entry count. The index begins at
offset 4 and uses 0x18-byte records holding a null-terminated CP932 filename, a 32-bit absolute
offset, and a 32-bit size. GARbro requires the index to end strictly before the file end.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| 16-bit entry count | Supported |
| CP932 filenames | Supported |
| Absolute offsets | Supported |
| Entry listing and extraction | Supported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
