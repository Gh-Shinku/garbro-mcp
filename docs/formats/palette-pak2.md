# Palette PACK2 archive

## Reference and attribution

- GARBro reference: `ArcFormats/Palette/ArcPAK2.cs`, class `Pak2Opener`
- GARBro tag: `PACK2/Palette`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`PACK2` archives start with the bytes `05 50 41 43 4b 32` (0x05 followed by `PACK2`) and a
32-bit entry count at offset 6. The index starts at 0x0a with variable-length name records: a
one-byte length, the name bytes XORed with 0xff, a 32-bit absolute offset, and a 32-bit size.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Length-prefixed XOR-0xFF names | Supported |
| Absolute offsets | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
