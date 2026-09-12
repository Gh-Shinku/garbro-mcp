# Mina ML200 archive

## Reference and attribution

- GARBro reference: `Legacy/Mina/ArcML2.cs`, class `Ml2Opener`
- GARBro tag: `ML2`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`ML200` archives start with the ASCII signature `ML200`, a 16-bit data offset at 6, a 32-bit
entry count at 8, a 32-bit index size at 0x0c, and a 32-bit index offset at 0x10. Index records
are variable length: a 32-bit size, a one-byte name length, and the name bytes. A size of
`0xffffffff` terminates the list; payloads are stored sequentially from the data offset.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Variable-length index records | Supported |
| Terminator handling | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
