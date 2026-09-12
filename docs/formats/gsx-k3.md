# Toyo GSX K3 archive

## Reference and attribution

- GARBro reference: `Legacy/Gsx/ArcK3.cs`, class `K3Opener`
- GARBro tag: `K3`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`K3` archives start with the ASCII signature `K3` and a 32-bit entry count at offset 2. The
index starts at 6 and uses 0x40-byte records with a 32-bit offset at +0, a 32-bit size at +4,
a 32-bit type at +0x0c, and a 0x20-byte CP932 filename at +0x20. Stored offsets are relative
to the end of the index.

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
