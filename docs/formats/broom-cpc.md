# Studio B-Room CPC resource archive

## Reference and attribution

- GARBro reference: `Legacy/BRoom/ArcCPC.cs`, class `CpcOpener`
- GARBro tag: `CPC`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `CPCG` archive stores an obfuscated record count at 4 (`count ^ 0xff559977`) and an encryption flag
at 8, both XORed, plus a key selector at 9. Records are 0x38 bytes with an offset, a size, and a
0x30-byte CP932 name that is decrypted byte-wise with the shipped 48-byte name key and terminated by
the first NUL.

Encrypted archives combine a per-record key from a 64-entry table with the offset and length tables
selected by the key index. Unencrypted archives instead apply a fixed position-dependent mask to each
offset and size. GARbro's bound check on the key index allows one value past the end of the tables, so
the port rejects any index that is not smaller than the table length instead of reading out of bounds
at run time.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Obfuscated count and flag | Supported |
| Name-key decryption | Supported |
| Encrypted offset and size tables | Supported |
| Unencrypted position-dependent masks | Supported |
| Key index validation | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the unencrypted and encrypted index paths, the key index bound, and signature
rejection.
