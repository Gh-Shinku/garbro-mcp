# KScript KPC archive

## Reference and attribution

- GARBro reference: `ArcFormats/KScript/ArcKPC.cs`, class `KpcOpener`
- GARBro tag: `KPC`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`KPC` archives start with `SCRPACK1`: the ASCII signature `SCRP`, the tag `ACK1` at offset 4,
a 32-bit entry count at offset 8, and a 32-bit index size at offset 0x0c. The encrypted index
starts at 0x20 and every byte is XORed with 0x45.

Decrypted records are 0x20 bytes with a null-terminated CP932 filename, a 32-bit absolute
offset at +0x18, and a 32-bit size at +0x1c.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| XOR-0x45 index decryption | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
