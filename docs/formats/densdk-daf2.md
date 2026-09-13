# DenSDK resource archives (DAF2)

## Reference and attribution

- GARBro reference: `ArcFormats/DenSDK/ArcDAF.cs`, class `Daf2Opener`, which extends `Daf1Opener`
- GARBro tag: `DAF2`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior. The base layout is
documented in `densdk-daf1.md`; DAF2 scrambles the same header words with a key and moves the index behind a
0x30-byte prefix.

## Header and key

The key is folded from four header bytes, most significant first:

```text
key = byte[0x20] << 24 | byte[0x25] << 16 | byte[0x2A] << 8 | byte[0x2F]
```

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | `DAF2` |
| 0x08 | 4 | Entry count, exclusive-ored with the key |
| 0x10 | 4 | Packed index size, exclusive-ored |
| 0x14 | 4 | Unpacked index size, exclusive-ored |
| 0x18 | 4 | 1 marks a zlib-packed index |
| 0x1C | 4 | Payload base offset, exclusive-ored |
| 0x30 | | Index |

A packed index is a zlib stream of `packed size` bytes at 0x30, inflated into an `unpacked size` buffer, and
the payload base becomes the end of that block instead of the stored field. A plain index is read from the
same offset, where a short read rejects the archive because the reference reserves the range first.

## Index records

Records use the same variable stride as DAF1, but with the scrambled fields and a name at +0x34:

| Field | Size | Meaning |
| --- | --- | --- |
| Record size | 4 | Exclusive-ored; at least 0x30 and inside the index |
| Offset | 4 | Exclusive-ored, then added to the payload base as a 32-bit add |
| Stored size | 4 | Exclusive-ored |
| Unpacked size | 4 | Exclusive-ored |
| Packed flag | 4 | At +0x30, **not** scrambled |
| Name | size − 0x34 | CP932, first NUL |

A record shorter than 0x34 leaves the name empty, which is what the reference's zero-length name read
amounts to.

## Payload handling

Inherited from DAF1: method 1 marks a zlib stream and everything else is returned as it is.

## Support

| Capability | Status |
| --- | --- |
| `DAF2` signature and the folded key | Supported |
| Exclusive-ored count, index sizes and payload base | Supported |
| Plain and zlib-packed indexes | Supported |
| Payload base override for a packed index | Supported |
| Variable-length records with scrambled fields | Supported |
| 32-bit wrap-around of the payload offsets | Supported |
| Placement checks and hierarchical path normalization | Supported |
| zlib inflation of packed payloads | Supported |
| Extension-based entry typing | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover stored and zlib entries behind a plain index, a zlib-packed index, a nested name, an
insane entry count, a record that is too small, a payload outside the archive, and a foreign signature.
