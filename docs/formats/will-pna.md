# Pulltop PNA multi-frame image archives

## Reference and attribution

- GARBro reference: `ArcFormats/Will/ArcPNA.cs`, class `PnaOpener`
- GARBro tag: `PNA`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `PNAP` archive holds one or more frames, each with its own image metadata and payload.

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | `PNAP` signature |
| 0x10 | 4 | Frame count |
| 0x14 | 0x28 × count | Frame records |

Frame records carry geometry and the stored size:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x08 | 4 | Frame x position |
| 0x0C | 4 | Frame y position |
| 0x10 | 4 | Frame width |
| 0x14 | 4 | Frame height |
| 0x24 | 4 | Stored size |

Payloads follow the table in record order, starting at `0x14 + count × 0x28`.

## Two details worth keeping

A record with a zero size is skipped, and — unlike a plain walk — it does not advance the payload cursor, while the
following frames still consume their own sizes in order. Frame names use the record index rather than the entry count,
so skipped records leave gaps: a single non-empty second record is named `<archive>#001`.

Frames are typed as images and carry their geometry — position, size and thirty-two bit colour — as metadata. Decoding
frame pixels belongs to the image layer and is out of scope here, so payloads are handed out as stored.

## Support

| Capability | Status |
| --- | --- |
| `PNAP` signature | Supported |
| Frame count at 0x10 | Supported |
| 0x28-byte frame table from 0x14 | Supported |
| Frame geometry metadata | Supported |
| Zero-size frame skipping without cursor advance | Supported |
| Record-index based frame names | Supported |
| Placement validation | Supported |
| Raw frame extraction | Supported |
| PNA pixel decoding (image layer) | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover metadata and payload extraction, a skipped leading frame, an unsane frame count, an
out-of-range frame and a truncated frame table.
