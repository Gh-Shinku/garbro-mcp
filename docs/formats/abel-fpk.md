# Abel FPK archive

## Reference and attribution

- GARBro reference: `ArcFormats/Abel/ArcFPK.cs`, class `FpkOpener`
- GARBro tag: `DAT/FPK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`FPK` archives start with the bytes `FPK` and a NUL, a 32-bit entry count at offset 4, and a
32-bit names size at offset 8. The index at 12 holds one 32-bit offset and one 32-bit size per
entry; a separate name section of the declared size follows the index and holds one
null-terminated CP932 name per entry in index order.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Separate name section | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
