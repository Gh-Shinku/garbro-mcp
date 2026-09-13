# FrontWing resource archives (FLT)

## Reference and attribution

- GARBro reference: `ArcFormats/FrontWing/ArcFLT.cs`, class `FltOpener`
- GARBro tag: `FLT`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior. The `CSF` resource alias from
the same reference file is not an archive and is not part of this port.

## Header

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 16 | `LIB_PACKDATA0000` |
| 0x14 | 4 | Entry count |
| 0x1C | 4 | 1 marks an encrypted index |
| 0x100 | count × 0x100 | Index |

An encrypted index has every byte substituted through a 256-byte table before it is parsed; the table is a
permutation of all byte values.

## Index records

Each record is 0x100 bytes:

| Field | Size | Meaning |
| --- | --- | --- |
| Name | variable | UTF-16LE, ends at the first pair of zero bytes |
| Compression | 1 | At +0xEA; 1 means a zlib stream |
| Encrypted | 1 | At +0xEB |
| Stored size | 4 | At +0xF0 |
| Unpacked size | 4 | At +0xF4 |
| Offset | 8 | At +0xF8 |

The name scan walks two bytes at a time up to 0xE8 and stops at a zero pair, so a name whose length is an odd
number of bytes can never be terminated and an empty name rejects the archive. Names are hierarchical, so
backslashes are normalized.

## Payload handling

An encrypted payload is exclusive-ored with a single key byte derived from its own offset: every byte of the
64-bit offset is folded together. A compressed payload is a zlib stream, and the exclusive-or is applied to
the stored bytes before inflation, so the order is unmask then inflate. An entry whose compression method is
anything other than 1 is returned as it is.

## Support

| Capability | Status |
| --- | --- |
| `LIB_PACKDATA0000` signature and the entry count | Supported |
| Encrypted indexes and the substitution table | Supported |
| 0x100-byte records with UTF-16 names | Supported |
| Compression, encryption, size and 64-bit offset fields | Supported |
| Placement checks and hierarchical path normalization | Supported |
| Offset-folded payload key and unmasking | Supported |
| zlib inflation of compressed payloads | Supported |
| Extension-based entry typing | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover stored and zlib entries, an encrypted index, an encrypted payload, a payload that is
both encrypted and compressed, a nested UTF-16 name, an empty name, a foreign signature, an insane entry
count, an index that reaches past the archive, a payload outside the archive, and a file too small for its
header.
