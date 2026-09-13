# BlackRainbow IMP image archives

## Reference and attribution

- GARBro reference: `ArcFormats/BlackRainbow/ArcIMP.cs`, class `ImpOpener`
- GARBro tag: `IMP`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The first word is both the signature and the scheme selector, because the XOR key an archive uses depends on the game it
came from. GARbro knows two schemes and only recognizes those:

| Signature | Key | Game |
| --- | --- | --- |
| 0x3D66 | 0xCE032ADB | Kannagi |
| 0x59E8 | 0xD36050EC | From M |

The four bytes at 0x04 begin a table of 0x100 offsets, so it ends exactly where the payloads start:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | Signature, which also picks the key |
| 0x04 | 4 | First frame offset |
| 0x08 | 0x3FC | One frame end offset per frame |
| 0x404 | — | Payloads |

Every frame runs from the previous offset to the next one; the reference iterates a fixed 0xFF times. Frames are named
`<archive>#<index>` with a three-digit index and typed as images. A frame of 0x10 bytes or less is skipped, which is how
the trailing offsets that repeat leave no frames behind. An archive with no remaining frames is rejected.

The reference reads these offsets without validating them against the archive size. A repeated or decreasing offset
therefore yields a zero or wrapped size, which the size filter drops or keeps exactly as it does.

## Extraction

The archive layer stores frames as they are, so payloads are handed out as raw ranges. Decoding a frame — XOR with the
scheme key, then LZSS, then a BGRA/BGR pixel grid — belongs to the image layer and is out of scope. The scheme key is
exposed in the archive metadata for that future step, together with the frame count.

## Support

| Capability | Status |
| --- | --- |
| `0x3D66` and `0x59E8` scheme signatures | Supported |
| Per-scheme XOR keys | Supported |
| 0xFF-frame offset table from 0x04 | Supported |
| Frames relative to 0x404 | Supported |
| Archive-name frame numbering and image typing | Supported |
| 0x10-byte frame size filter | Supported |
| Raw frame extraction and key metadata | Supported |
| IMP pixel decoding (image layer) | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover both schemes, frame listing and extraction, the skipped small frame, an archive without frames,
an unknown scheme and a truncated header.
