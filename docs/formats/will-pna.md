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

Frames are typed as images and carry their geometry — position, size and thirty-two bit colour — as metadata. The
payload of a frame is a **picture of its own** (a portable network graphic, a JPEG or a bitmap), which this port reads
with its own walks, hands over as four places of a colour to a pixel, and then stands the covering place of every pixel
off: where the covering place of a pixel stands of neither nought nor the whole, the three places of its colour stand of
the places of the file of the picture taken against that covering place, which is what `PnaDecoder.ReadPixels` does. The
counts of the head of the frame must stand of the counts of the picture itself, where the reference hands the places of
the picture over of the counts of the frame.

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
| Frame picture decoding (portable network graphic, JPEG, bitmap) | Supported |
| Covering place of a pixel stood of (un-premultiplied) | Supported |
| PNA pixel decoding (image layer) | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the metadata of the listing, a skipped leading frame without a cursor advance, an unsane frame
count, an out-of-range frame and a truncated frame table, and the walk of the pictures of the frames: a picture of four
places of a colour whose covering places stand on their own, one whose covering place stands of the whole, one whose
covering place stands of nought, a picture of three places of a colour, and a payload that stands of no picture.
