# AQA archive

## Reference and attribution

- GARBro reference: `Legacy/Unknown/ArcAQA.cs`, class `AqaOpener`
- GARBro tag: `AQA`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`AQA ` archives start with the ASCII signature `AQA `, a 32-bit key seed at offset 8, and a
32-bit entry count at offset 12. The key is `((101 * seed + 777) & 0xffff) + 1`; the index at
0x18 is XORed as little-endian 16-bit words with that key. Decrypted records are 0x90 bytes
with a 0x80-byte CP932 name, a 32-bit size at +0x80, and a 32-bit offset at +0x88 relative to
the end of the index.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| 16-bit XOR index decryption | Supported |
| Base-relative offsets | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
