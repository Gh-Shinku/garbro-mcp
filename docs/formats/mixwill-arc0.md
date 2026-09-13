# Mixwill soft ARC0 archive

## Reference and attribution

- GARBro reference: `ArcFormats/Mixwill/ArcARC0.cs`, class `Arc0Opener`
- GARBro tag: `ARC0`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2017 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `ARC0` archive starts with the ASCII signature and keeps its record count at 0x10004, so a large
header region precedes the index. Records begin at 0x10008 and are 0x110 bytes wide: a 0x100-byte
name field, a 32-bit stored size, and a 32-bit data offset, both little-endian.

Every name byte is XORed with its position inside the 0x100-byte field; the first decoded zero ends
the name, and GARbro rejects the archive when that zero is the first byte. The stored extension of
the descriptor is `arc`.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| 0x110-byte index records | Supported |
| Position-XORed name fields | Supported |
| Empty name rejection | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover name unmasking, empty name rejection, and entry placement rejection.
