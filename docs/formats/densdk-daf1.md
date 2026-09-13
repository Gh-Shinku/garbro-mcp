# DenSDK resource archives (DAF1)

## Reference and attribution

- GARBro reference: `ArcFormats/DenSDK/ArcDAF.cs`, class `Daf1Opener`
- GARBro tag: `DAF1`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior. The sibling `Daf2Opener`
from the same reference file is documented in `densdk-daf2.md`, and both layouts share the same payload
handling.

## Header and index

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | `DAF1` |
| 0x04 | 4 | Index offset |
| 0x08 | 4 | Entry count |
| 0x10 | 4 | Payload area offset |

The index runs from its own offset up to the payload area, which is what the reference reserves before it
reads anything, so a record may never reach past it. Records have no fixed stride, because each one starts
with its own length:

| Field | Size | Meaning |
| --- | --- | --- |
| Record size | 4 | Includes the header; 0x18 or less rejects the archive |
| Offset | 4 | Absolute payload offset |
| Stored size | 4 | |
| Unpacked size | 4 | |
| Packed flag | 4 | At +0x14 |
| Name | size − 0x18 | CP932, first NUL |

Names are hierarchical, so backslashes are normalized.

## Payload handling

Compression method 1 marks a zlib stream; everything else is returned as it is. An entry reports the unpacked
size when it is compressed and its stored size otherwise.

## Support

| Capability | Status |
| --- | --- |
| `DAF1` signature, index offset and payload area bounds | Supported |
| Variable-length records with their own size | Supported |
| Names, offsets, sizes and the packed flag | Supported |
| Placement checks and hierarchical path normalization | Supported |
| zlib inflation of packed payloads | Supported |
| Extension-based entry typing | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover stored and zlib entries, a nested name, a record that is too small, and a payload
area that precedes the index.
