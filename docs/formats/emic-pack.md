# Emic engine PACK resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Emic/ArcPACK.cs`, class `PacOpener`
- GARBro tag: `PAC/EMIC`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `PACK` archive is registered for the `pac` extension and uses one of two header layouts. The first
stores the record count at 0x28 and the encryption flag at 4 with a 0x20-byte key at 8; when those are
not plausible GARbro falls back to a count at 4, a flag at 8, and a key at 0xC. In both layouts the key
is masked with a constant, 0xAA or 0xAB respectively, and the index begins at 0x2C.

Index records are a 32-bit name length between 1 and 0x108, that many CP932 name bytes, the stored
size, and the data offset. When the flag is one, the whole stream is XORed with the key cycled from
position zero, and payloads use the same key starting at their own file offset, which is why the port
keeps the key in the entry metadata.

## Support

| Capability | Status |
| --- | --- |
| Signature and extension detection | Supported |
| Primary and secondary header layouts | Supported |
| Masked key extraction | Supported |
| Encrypted index decryption | Supported |
| Offset-aligned payload decryption | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover both header layouts, the encrypted path, extension rejection, and signature
rejection.
