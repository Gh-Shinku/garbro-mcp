# Pajamas Adventure System GAMEDAT archive

## Reference and attribution

- GARBro reference: `ArcFormats/Pajamas/ArcGameDat.cs`, class `DatOpener`
- GARBro tag: `GAMEDAT`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The header carries the `GAMEDAT PAC` signature and a version marker at 0x0b: `K` selects a 16-byte
name field and `2` a 32-byte one. A 32-bit record count follows at 0x0c, the names fill the block
behind it, and the index then holds eight-byte records with a 32-bit offset relative to the data base
plus the stored size.

Payloads named `textdata.bin` can be obfuscated. GARbro applies a rolling XOR — key 0xc5 advancing by
0x5c per byte — only when the stored payload starts with the marker `95 6b 3c 9d 63`, which decrypts
to the `PJADV` magic. Other payloads, including `textdata.bin` entries without that marker, pass
through unchanged.

## Support

| Capability | Status |
| --- | --- |
| Signature and version detection | Supported |
| 16-byte and 32-byte name fields | Supported |
| Relative offset index | Supported |
| Rolling-XOR `textdata.bin` decryption | Supported |
| Marker-gated decryption | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover both versions, payload decryption, the marker gate, version rejection, and
entry placement rejection.
