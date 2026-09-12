# SLG SZS archive

## Reference and attribution

- GARBro reference: `ArcFormats/Slg/ArcSZS.cs`, class `SzsOpener`
- GARBro tag: `SZS`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2017 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`SZS1` archives carry a version character at offset 4, the platform tag `0__` at offset 5,
and a 32-bit entry count at 0x0c. The index starts at 0x10 and uses 0x110-byte records with a
0x100-byte CP932 filename, a 64-bit offset at +0x100, and a 32-bit size at +0x108. Semicolons
in names become path separators, and every entry is XOR-0x90 encrypted.

## Support

| Capability | Status |
| --- | --- |
| Signature and version detection | Supported |
| 64-bit offsets | Supported |
| XOR-0x90 entry decryption | Supported |
| Semicolon path mapping | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
