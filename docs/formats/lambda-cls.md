# Lambda CLS archive

## Reference and attribution

- GARBro reference: `ArcFormats/Lambda/ArcCLS.cs`, class `ClsOpener`
- GARBro tag: `DAT/CLS`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`CLS` archives start with the ASCII signature `CLS_` followed by `FILELINK`, a 32-bit entry
count at 0x10, and a 32-bit index pointer at 0x18. Index records are 0x40 bytes with a
0x28-byte CP932 name, a 32-bit offset at +0x2c, and a 32-bit size at +0x30.

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
