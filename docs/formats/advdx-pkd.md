# AdvDX PKD archive

## Reference and attribution

- GARBro reference: `ArcFormats/AdvDx/ArcPKD.cs`, class `PkdOpener`
- GARBro tag: `PKD`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `PKD` archive starts with the ASCII signature `PACK`, a 32-bit record count at 4, and the key
byte at 0x87, which is the last byte of the first record's name field. The index begins at 8 and is
`0x88 * count` bytes long; every byte is XORed with the key. A record is a 0x80-byte CP932 name, a
32-bit stored size, and a 32-bit data offset.

The same key decrypts every entry payload, so an archive with a zero key is stored in the clear.
GARbro rejects records with a blank name and any entry outside the file.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| XOR-encrypted index | Supported |
| XOR-encrypted payloads | Supported |
| Blank-name rejection | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover index and payload decryption, the zero-key case, and entry placement
rejection.
