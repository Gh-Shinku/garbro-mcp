# Irrlicht ARK archive

## Reference and attribution

- GARBro reference: `ArcFormats/Irrlicht/ArcARK.cs`, class `ArkOpener`
- GARBro tag: `ARK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2017 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`ARK` archives store a 32-bit entry count at offset 0 and an index from offset 4 with
0x10c-byte records. Names are 0x104-byte fields obfuscated with XOR 0xff and terminated by a
0xff byte; the offset is at +0x104 and the size at +0x108. The first record offset must equal
`4 + count * 0x10c`. Both names and payloads are XORed with 0xff.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| XOR-0xFF name and payload deobfuscation | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
