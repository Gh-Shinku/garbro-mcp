# Studio B-Room encrypted PK resource archive

## Reference and attribution

- GARBro reference: `Legacy/BRoom/ArcPK.cs`, class `EncryptedPkOpener`
- GARbro tag: `PK/B-ROOM/E`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

This variant keeps the 0x18-byte record stride of the plain archive but encrypts everything else. The entry
count is the word at 0 exclusive-ored with a fixed mask, and each record holds an obfuscated offset and
size plus fourteen name bytes exclusive-ored with a fixed key.

The decrypted name bytes up to the terminator fold into a ten-bit checksum — each byte shifted by eight
times its position within a group of four — and that checksum masks both the offset and the size of its own
entry, so a record can only be read together with its name. A name with no extension, or with an `.e` or
`.er` one, has its extension replaced by `.Erp`.

Unlike the plain variant the reference never requires the payloads to cover the file exactly, so neither
does the port; it only requires the index to end inside the file. Payloads are extracted verbatim, since the
obfuscation applies to the index rather than to the data.

## Support

| Capability | Status |
| --- | --- |
| Masked entry count | Supported |
| 0x18-byte records with fourteen encrypted name bytes | Supported |
| Name checksum folded into offset and size | Supported |
| Extension replacement to `.Erp` | Supported |
| Index and placement validation | Supported |
| CP932 names with blank rejection | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover two entries with rewritten extensions and a bad count.
