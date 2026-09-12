# Kogado LPK archive

## Reference and attribution

- GARBro reference: `ArcFormats/Hypatia/ArcLPK.cs`, class `LpkOpener`
- GARBro tag: `LPK/KOGADO`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`LPK` files are detected by extension and must be at least 0x2800 bytes. Up to 0x200
0x10-byte names occupy the first 0x200 bytes and the walk stops at the first zero byte. The
offset table starts at 0x2000 and holds one extra sentinel value; payload offsets are relative
to 0x2800. GARbro rejects names that are empty or rooted, which this port mirrors.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Fixed name area | Supported |
| Sentinel offset table | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
