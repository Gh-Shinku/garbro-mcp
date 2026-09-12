# CDPA PACK archive

## Reference and attribution

- GARBro reference: `ArcFormats/CDPA/ArcPACK.cs`, class `PackOpener`
- GARBro tag: `PACK/CDPA`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`PACK` archives start with the ASCII signature `PACK` and a 32-bit entry count at offset 4.
The index starts at 8 and uses 0x28-byte records with a 0x20-byte CP932 filename, a 32-bit
size at +0x20, and a 32-bit absolute offset at +0x24. Offsets must point past the index.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Index-following offsets | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
