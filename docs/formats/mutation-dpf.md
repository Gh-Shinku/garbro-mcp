# Mutation DPF archive

## Reference and attribution

- GARBro reference: `Legacy/Mutation/ArcDPF.cs`, class `DpfOpener`
- GARBro tag: `DPF`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`DPFL` archives start with the ASCII signature `DPFL` and a 16-bit entry count at offset 4.
The index starts at 6 and uses 0x18-byte records with a 16-byte CP932 name, a 32-bit absolute
offset at +0x10, and a 32-bit size at +0x14.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| 16-bit entry count | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
