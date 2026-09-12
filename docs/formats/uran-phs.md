# KuonAdv PHS archive

## Reference and attribution

- GARBro reference: `Legacy/Uran/ArcPHS.cs`, class `PhsOpener`
- GARBro tag: `PHS`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`KPHS` archives start with the ASCII signature `KPHS` and a 32-bit entry count at 0x0c. The
index starts at 0x50 and uses 0x14-byte records with a 12-byte CP932 name, a 32-bit offset at
+0x0c relative to the end of the index, and a 32-bit size at +0x10.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Base-relative offsets | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
