# AIMS PACK archive

## Reference and attribution

- GARbro reference: `ArcFormats/Aims/ArcPACK.cs`, class `PackOpener`
- GARbro tag: `PACK/AIMS`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`PACK` archives start with the ASCII signature `PACK` and a 32-bit entry count at offset 4. The
index starts at 8 and uses 0x50-byte records:

| Offset | Size | Meaning |
| --- | ---: | --- |
| 0x00 | 0x40 | null-terminated CP932 filename |
| 0x40 | 4 | name CRC-32 |
| 0x44 | 4 | data CRC-32 |
| 0x48 | 4 | absolute 32-bit offset |
| 0x4c | 4 | 32-bit size |

Payloads whose first four bytes are `LZSS` are not LZSS-compressed: the tag is followed by a 32-bit
unpacked size at +4 and a Blowfish-encrypted payload at +8. GARbro decrypts that payload with the
56-byte AIMS default key and exposes the first `unpackedSize` bytes; the `LzssStream` branch in
GARbro only runs when no key is configured, which does not happen with the built-in key.

The Blowfish decryptor uses GARbro's little-endian 32-bit half convention, so payloads must be
block aligned (a multiple of 8 bytes).

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| CP932 filenames | Supported |
| Default-key Blowfish decryption | Supported |
| Unpacked-size trimming | Supported |
| Raw entries | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover raw and Blowfish-encrypted entries. The Blowfish codec itself is verified
against OpenSSL vectors in `tests/unit/blowfish.test.ts`.
